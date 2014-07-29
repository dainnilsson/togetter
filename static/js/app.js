'use strict';

var app = angular.module('togetter', ['ngRoute', 'ngStorage', 'ui.bootstrap']);

/*
 * Configuration
 */

app.config(['$routeProvider', '$locationProvider',
                function($routeProvider, $locationProvider) {
  $locationProvider.html5Mode(true);

  $routeProvider.when('/', {
    resolve: { redirect: 'IndexRedirector' }
  }).when('/welcome', {
    templateUrl: '/static/partials/welcome.html',
    controller: 'WelcomeController'
  }).when('/:groupId', {
    templateUrl: '/static/partials/group.html',
    controller: 'GroupController'
  }).when('/:groupId/:listId', {
    templateUrl: '/static/partials/list.html',
    controller: 'ListController'
  });
}]);

/*
 * Services
 */

app.factory('IndexRedirector',
                ['$location', '$localStorage',
                function($location, $localStorage) {
  $location.path($localStorage.last || '/welcome');
}]);

app.factory('activityMonitor', ['$window', '$document', '$rootScope',
                function($window, $document, $rootScope) {
  var mon = {
    latest: Date.now(),
    threshold: 30000
  };

  mon.touch = function() {
    var now = Date.now();
    if(now - mon.latest > mon.threshold) {
      console.log("Return from idle!");
      $rootScope.$broadcast('awake');
    }
    mon.latest = now;
  }

  var d = angular.element($document);
  d.on('visibilitychange msvisibilitychange mozvisibilitychange webkitvisibilitychange', mon.touch);
  var w = angular.element($window);
  w.on('online focus touchmove mousemove mousedown mousewheel keydown DOMMouseScroll', mon.touch);

  return mon;
}]);

app.factory('Channel',
                ['$rootScope', '$localStorage', '$http', 'activityMonitor', 
                function($rootScope, $localStorage, $http, activityMonitor) {
  return function(groupId, connected, onmessage) {
    var that = this;
    var storageKey = 'channel-'+groupId;

    that.close = function() {
      console.log("Channel closed");
      that.reconnect = undefined;
      clearTimeout(that.timeout);
      if(that.socket) {
        that.socket.onclose = undefined;
        that.socket.close();
      }
    }

    that.reconnect = function() {
      if(!$localStorage[storageKey]) {
        $http.post('/api/'+groupId+'/', null, {
          params: {'action': 'create_channel'}
        }).success(function(res) {
          $localStorage[storageKey] = {'token': res.token, 'client_id': res.client_id};
          that.reconnect();
        }).error(function(data, status, headers, config) {
          console.log("Error subscribing");
          that.timeout = setTimeout(that.reconnect, 10000);
        });
        return;
      }
      var token = $localStorage[storageKey].token;
      that.client_id = $localStorage[storageKey].client_id;
      console.log("Connecting channel:", that.client_id);

      that.channel = new goog.appengine.Channel(token);
      that.socket = that.channel.open();
      that.socket.onmessage = function(message) {
        if(message.data == "pong") {
          clearTimeout(that.timeout);
          return;
        }
        var data = angular.fromJson(message.data);
        console.log("Got message", data, that.client_id);
        onmessage && $rootScope.$apply(function() { onmessage(data); });
        activityMonitor.touch();
      };
      that.socket.onerror = function() {
        console.log("onerror");
      };
      that.socket.onclose = function() {
        console.log("onclose");
        $localStorage[storageKey] = undefined;
        that.client_id = undefined;
        that.channel = undefined;
        that.socket = undefined;
        $rootScope.$apply(that.reconnect);
      };
      connected && connected();
    };

    that.ping = function() {
      $http.post('/api/'+groupId+'/', null, {
        params: {'action': 'ping_channel', 'token': that.client_id}
      }).success(function() {
        that.timeout = setTimeout(that.reconnect, 5000);
      }).error(function() {
        console.log("Detected broken channel, reconnect...");
        if(that.socket) {
          that.socket.close();
        }
      });
    }

    $rootScope.$on('awake', that.ping);
    that.reconnect();
  };
}]);

app.factory('ItemCompleter', ['$http', function($http) {
  return function(groupId) {
    var that = this;
    var ingredients = [];
    
    that.refresh = function() {
      $http.get('/api/'+groupId+'/ingredients/').success(function(res) {
        that.ingredients = res;
      });
    };
  
    that.add_ingredient = function(ingredient) {
      this.ingredients.push(ingredient);
      this.ingredients.sort();
    };

    that.filter = function(partial) {
      partial = partial.trim();
      var matches = [];
      var exact = false;
      var partial_lower = partial.toLowerCase();
      for(var i=0; i<that.ingredients.length; i++) {
        var ingredient = that.ingredients[i];
        if(partial == ingredient) {
          exact = true;
	  matches.push(ingredient);
          continue;
        }
        var words = ingredient.split(' ');
        for(var j=0; j<words.length; j++) {
          var word = words[j];
          if(word.toLowerCase().substr(0, partial.length) == partial_lower) {
            matches.push(ingredient);
	    break;
          }
        }
      }
      if(!exact) {
        matches.unshift(partial);
      }
      return matches;
    };

    that.refresh();
  };
}]);

app.factory('GroupApi',
                ['$localStorage', '$http', 'ListApi', 'Channel', 'ItemCompleter',
                function($localStorage, $http, ListApi, Channel, ItemCompleter) {
  return function(groupId) {
    var that = this;
    var groupUrl = '/api/'+groupId+'/';
    
    that.id = groupId;

    that.set_data = function(data) {
      that.data = data;
      that.commit();
    };

    that.commit = function() {
      $localStorage[groupId] = angular.copy(that.data);
    }

    that.revert = function() {
      that.data = angular.copy($localStorage[groupId]);
    };

    that.refresh = function() {
      $http.get(groupUrl).success(that.set_data);
    };

    that.revert_and_refresh = function() {
      that.revert();
      that.refresh();
    }

    that.create_list = function(list_name) {
      return $http.post(groupUrl, null, {
        params: {
          'action': 'create_list',
          'label': list_name
        }
      }).then(function(resp) {
        console.log("created", resp.data.id);
        return that.list(resp.data.id).id;
      });
    };

    that._lists = {};
    that.list = function(listId) {
      if(!that._lists[listId]) {
        that._lists[listId] = new ListApi(that, listId);
      }
      return that._lists[listId];
    };

    that.destroy = function() {
      console.log("destructor");
      that.channel.close();
    };

    that.item_completer = new ItemCompleter(groupId);

    that.channel = new Channel(groupId, function() {
      console.log('reconnect');
      for(var list_id in that._lists) {
        that.list(list_id).refresh();
      }
    }, function(list_data) {
      console.log("Remote modification!", list_data);
      that.list(list_data.id).set_data(list_data);
      for(var i=0; i<list_data.items.length; i++) {
        var item = list_data.items[i];
	if(that.item_completer.ingredients.indexOf(item.item) == -1) {
          that.item_completer.add_ingredient(item.item);
	}
      }
    });

    that.revert_and_refresh();
  };
}]);

app.factory('groupProvider', ['$rootScope', 'GroupApi', function($rootScope, GroupApi) {
  return function(groupId) {
    if($rootScope.group_api) {
      if($rootScope.group_api.data.id == groupId) {
        return $rootScope.group_api;
      }
      $rootScope.group_api.destroy();
    }
    $rootScope.group_api = new GroupApi(groupId);
    window.root = $rootScope;
    return $rootScope.group_api;
  }
}]);

app.factory('ListApi',
                ['$http', '$localStorage', function($http, $localStorage) {
  return function(group_api, listId) {
    var that = this;
    var listUrl = '/api/'+group_api.id+'/lists/'+listId+'/';
    var storageKey = group_api.id+'/'+listId;

    that.id = listId;

    that.set_data = function(data) {
      that.data = data;
      that.commit();
    };

    that.commit = function() {
      $localStorage[storageKey] = angular.copy(that.data);
    }

    that.revert = function() {
      that.data = angular.copy($localStorage[storageKey]);
    };

    that.refresh = function() {
      console.log("Refresh list: "+that.id);
      $http.get(listUrl).success(that.set_data);
    };

    that.revert_and_refresh = function() {
      that.revert();
      that.refresh();
    }

    that.add_item = function(item) {
      return $http.post(listUrl, null, {
        params: {
          'action': 'add',
          'item': item,
          'token': group_api.channel.client_id
        }
      }).success(function() {
        group_api.item_completer.add_ingredient(item);
        that.refresh();
      });
    };

    that.update_item = function(item) {
      return $http.post(listUrl, null, {
        params: {
          'action': 'update',
          'item': item.item,
          'amount': item.amount,
          'collected': item.collected,
          'token': group_api.channel.client_id
        }
      }).success(that.commit).error(that.revert_and_refresh);
    };

    that.move_item = function(index, splice) {
      if(index == splice) {
        return;
      }
      var item = that.data.items[index];
      that.data.items.splice(index, 1);
      that.data.items.splice(splice, 0, item);
      var prev = that.data.items[splice-1];
      var next = that.data.items[splice+1];
      that.data.items = angular.copy(that.data.items); //Needed to refresh sometimes.

      return $http.post(listUrl, null, {
        params: {
          'action': 'reorder',
          'item': item.item,
          'prev': prev ? prev.item : undefined,
          'next': next ? next.item : undefined,
          'token': group_api.channel.client_id
        }
      }).success(that.commit).error(that.revert_and_refresh);
    };

    that.clear_collected = function() {
      var remaining = [];
      angular.forEach(that.data.items, function(item) {
        if(!item.collected) {
          remaining.push(item);
        }
      });
      that.data.items = remaining;

      return $http.post(listUrl, null, {
        params: {
          'action': 'clear',
          'token': group_api.channel.client_id
        }
      }).success(that.commit).error(that.revert_and_refresh);
    };

    that.revert_and_refresh();
  };
}]);

/*
 * Controllers
 */

app.controller('IndexController',
                ['$location', '$localStorage',
                function($location, $localStorage) {
  $location.path($localStorage.last || '/welcome');
}]);

app.controller('WelcomeController',
                ['$scope', '$location', '$http', '$localStorage',
                function($scope, $location, $http, $localStorage) {
  $scope.$root.title = 'welcome';
  $scope.set_group = function(groupId) {
    $location.path('/'+groupId);
  }

  $scope.create_group = function(group_name) {
    $http.post('/api/create', null, {
      params: {'label': group_name}
    }).success(function(data) {
      $location.path('/'+data.id);
    });
  };
}]);

app.controller('GroupController',
                ['$scope', '$routeParams', '$http', '$localStorage', '$location', 'groupProvider',
                function($scope, $routeParams, $http, $localStorage, $location, groupProvider) {
  $localStorage.last = $location.path();
  $scope.groupId = $routeParams.groupId;

  var group_api = groupProvider($scope.groupId);
  $scope.$root.title = group_api.data.label;
  $scope.group = group_api;

  $scope.create_list = function(list_name) {
    group_api.create_list(list_name).then(function(listId) {
      $location.path('/'+$scope.groupId+'/'+listId);
    });
  }
}]);

app.controller('ListController',
                ['$scope', '$routeParams', '$http', '$location', '$localStorage', 'groupProvider',
                function($scope, $routeParams, $http, $location, $localStorage, groupProvider) {
  $localStorage.last = $location.path();

  $scope.groupId = $routeParams.groupId;
  $scope.listId = $routeParams.listId;

  var group_api = groupProvider($scope.groupId);
  var list_api = group_api.list($scope.listId);
  $scope.$root.title = list_api.data.label;

  $scope.list = list_api;
  $scope.filter_items = group_api.item_completer.filter;

  $scope.add_item = function() {
    var item = $scope.new_item;
    $scope.new_item = undefined;
    list_api.add_item(item).then(undefined, function() {
      $scope.new_item = item;
    });
  };

  $scope.update_item = list_api.update_item;
  $scope.increment_amount = function(item) {
    item.amount++;
    list_api.update_item(item);
  };
  $scope.decrement_amount = function(item) {
    if(item.amount > 1) {
      item.amount--;
      list_api.update_item(item);
    }
  };

  $scope.move_item = function(e) {
    list_api.move_item(e.detail.originalIndex, e.detail.spliceIndex);
    window.root = $scope;
  };

  $scope.clear_collected = list_api.clear_collected;

  $scope.$on('awake', list_api.refresh);
}]);

/*
 * Directives
 */

app.directive('ngReorderable', ['$parse', function($parse) {
  return function(scope, element, attrs) {
    new Slip(element[0]);
    var fn = $parse(attrs.onReorder);
    element.bind("slip:reorder", function(event) {
      event.target.parentNode.insertBefore(event.target, event.detail.insertBefore);
      scope.$apply(function() {
        fn(scope, {$event:event});
      });

      return false;
    });
    element.bind("slip:beforewait", function(event) {
      if(event.target.className.indexOf('slip-instant') > -1) {
        event.preventDefault();
      }
    });
  };
}]);
