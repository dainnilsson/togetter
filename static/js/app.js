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
    threshold: 10000
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
		['$rootScope', '$http', 'activityMonitor', 
		function($rootScope, $http, activityMonitor) {
  return function(groupId, connected, onmessage) {
    var that = this;

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
      if(that.socket) {
        that.socket.close();
	return;
      }

      $http.post('/api/'+groupId+'/', null, {
        params: {'action': 'create_channel'}
      }).success(function(res) {
        var token = res.token;
	that.client_id = res.client_id;
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
	  that.socket = undefined;
	  $rootScope.$apply(that.reconnect);
        };
	connected && connected();
      }).error(function(data, status, headers, config) {
        console.log("Error subscribing");
	that.timeout = setTimeout(that.reconnect, 10000);
      });
    };

    that.ping = function() {
      $http.post('/api/'+groupId+'/', null, {
        params: {'action': 'ping_channel', 'token': that.client_id}
      }).success(function() {
        that.timeout = setTimeout(that.reconnect, 5000);
      }).error(function() {
        console.log("Detected broken channel, reconnect...");
        that.reconnect();
      });
    }

    $rootScope.$on('awake', that.ping);
    that.reconnect();
  };
}]);

app.factory('GroupApi',
		['$localStorage', '$http', 'ListApi', 'Channel',
		function($localStorage, $http, ListApi, Channel) {
  return function(groupId) {
    var that = this;
    var groupUrl = '/api/'+groupId+'/';
    
    that.id = groupId;
    that.data = $localStorage[groupId] || {};

    that.set_data = function(data) {
      that.data = data;
      $localStorage[groupId] = that.data;
      console.log("Group refreshed!", that.data);
    };

    that.refresh = function() {
      $http.get(groupUrl).success(that.set_data);
    };

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

    that.channel = new Channel(groupId, function() {
      console.log('reconnect');
      for(var list_id in that._lists) {
        that.list(list_id).refresh();
      }
    }, function(list_data) {
      console.log("Remote modification!", list_data);
      that.list(list_data.id).set_data(list_data);
    });

    that.refresh();
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
    that.data = $localStorage[storageKey] || {};

    that.set_data = function(data) {
      that.data = data;
      $localStorage[storageKey] = that.data;
      console.log("List refreshed!", that.data);
    };

    that.refresh = function() {
      $http.get(listUrl).success(that.set_data);
    };

    that.add_item = function(item) {
      return $http.post(listUrl, null, {
        params: {
          'action': 'add',
          'item': item,
	  'token': group_api.channel.client_id
        }
      }).success(that.refresh);
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
      }).success(function() {
        $localStorage[storageKey] = that.data;
      }).error(that.refresh);
    };

    that.move_item = function(index, splice) {
      var item = that.data.items[index];
      that.data.items.splice(index, 1);
      that.data.items.splice(splice, 0, item);
      var prev = that.data.items[splice-1];
      var next = that.data.items[splice+1];

      return $http.post(listUrl, null, {
        params: {
          'action': 'reorder',
          'item': item.item,
          'prev': prev ? prev.item : undefined,
          'next': next ? next.item : undefined,
	  'token': group_api.channel.client_id
        }
      }).success(function() {
        $localStorage[storageKey] = that.data;
      }).error(that.refresh);
    };

    that.clear_collected = function() {
      return $http.post(listUrl, null, {
        params: {
          'action': 'clear',
          'token': group_api.channel.client_id
        }
      }).success(function() {
        var remaining = [];
        angular.forEach(that.data.items, function(item) {
          if(!item.collected) {
            remaining.push(item);
          }
        });
        that.data.items = remaining;
        $localStorage[storageKey] = that.data;
      });
    };

    that.refresh();
  };
}]);

//app.factory('ItemCompleter',
//		['$cacheProvider']);

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
  $scope.group = group_api;
  window.group_api = group_api;

  $scope.create_list = function(list_name) {
    group_api.create_list(list_name).then(function(listId) {
      $location.path('/'+$scope.groupId+'/'+listId);
    });
  }
}]);

app.controller('ListController',
		['$scope', '$routeParams', '$http', '$location', 'groupProvider', '$localStorage',
		function($scope, $routeParams, $http, $location, groupProvider, $localStorage) {
  $localStorage.last = $location.path();

  $scope.groupId = $routeParams.groupId;
  $scope.listId = $routeParams.listId;

  var list_api = groupProvider($scope.groupId).list($scope.listId);

  $http.get('/api/'+$scope.groupId+'/').success(function(res) {
    $scope.group = res;
  });

  $scope.list = list_api;

  $scope.filter_items = function(viewValue) {
    return $http.post('/api/'+$scope.groupId+'/ingredients/', null, {
      params: { 'query': viewValue }
    }).then(function(res) {
      if(res.data.length > 0 && res.data.indexOf(viewValue) == -1) {
        res.data.unshift(viewValue);
      }
      return res.data;
    });
  };

  $scope.add_item = function() {
    list_api.add_item($scope.new_item).then(function() {
      $scope.new_item = undefined;
    });
  };

  $scope.update_item = list_api.update_item;

  $scope.move_item = function(e) {
    list_api.move_item(e.detail.originalIndex, e.detail.spliceIndex);
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
        //event.preventDefault();
      }
    });
  };
}]);
