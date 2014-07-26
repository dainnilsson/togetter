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

app.factory('activityMonitor', ['$window', '$rootScope', function($window, $rootScope) {
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

  var w = angular.element($window);
  w.on('online focus touchmove mousemove mousedown mousewheel keydown DOMMouseScroll', mon.touch);

  //Stutter detection (indicates screen may have been off)
  var tick = Date.now();
  setInterval(function() {
    $rootScope.$apply(function() {
      var now = Date.now();
      if(now - tick > 1100) {
        mon.touch();
      }
      tick = now;
    });
  }, 1000);

  return mon;
}]);

app.factory('listener',
		['$http', '$rootScope', 'activityMonitor',
		function($http, $rootScope, activityMonitor) {
  var listener = {
    handlers: {},
    channel: undefined,
    groupId: undefined
  };

  $rootScope.$on('awake', function() {
    if(!listener.channel) {
      listener.connect();
    } else {
      listener.notify();
    }
  });

  listener.subscribe = function(groupId) {
    if(listener.groupId != groupId) {
      listener.groupId = groupId;
      if(listener.socket) {
        listener.socket.close();
      } else {
        listener.connect();
      }
    }
  };

  listener.connect = function() {
    if(!listener.groupId) return;

    $http.post('/api/'+listener.groupId+'/', null, {
      params: {'action': 'create_channel'}
    }).success(function(res) {
      listener.token = res.token;
      listener.channel = new goog.appengine.Channel(listener.token);
      listener.socket = listener.channel.open();
      listener.socket.onmessage = function(message) {
        var data = angular.fromJson(message.data);
        console.log("Got message", data, res.token);
        var handler = listener.handlers[data.id];
        handler && handler(data);
	activityMonitor.touch();
      };
      listener.socket.onerror = function() {
        console.log("onerror");
      };
      listener.socket.onclose = function() {
        listener.channel = undefined;
	listener.socket = undefined;
        listener.connect();
        console.log("onclose");
      };
    }).error(function(data, status, headers, config) {
      console.log("Error subscribing");
    });
  };

  listener.notify = function() {
    $http.post('/api/'+listener.groupId+'/', null, {
      params: {'action': 'notify', 'token': listener.token}
    }).success(function() {
      activityMonitor.touch();
    });
  };

  listener.keepAlive = setInterval(function() {
    if($rootScope.window_focus) {
      if(!listener.channel) {
        listener.connect();
      }
      listener.notify();
    }
  }, 10000);
  
  return listener;
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
		['$scope', '$routeParams', '$http', '$localStorage', '$location',
		function($scope, $routeParams, $http, $localStorage, $location) {
  $scope.groupId = $routeParams.groupId;

  $scope.create_list = function(list_name) {
    $http.post('/api/'+$scope.groupId+'/', null, {
      params: {
        'action': 'create_list',
        'label': list_name
      }
    }).success(function(data) {
      $location.path('/'+$scope.groupId+'/'+data.id)
    });
  }

  $http.get('/api/'+$scope.groupId+'/').success(function(res) {
    $localStorage.last = $location.path();
    $scope.group = res
  });
}]);

app.controller('ListController',
		['$scope', '$routeParams', '$http','$localStorage', '$location', 'listener', 'activityMonitor',
		function($scope, $routeParams, $http, $localStorage, $location, listener, am) {
  $localStorage.last = $location.path();

  $scope.groupId = $routeParams.groupId;
  $scope.listId = $routeParams.listId;

  listener.subscribe($scope.groupId);
  listener.handlers[$scope.listId] = function(list) {
    $localStorage[$scope.listId] = list;
    $scope.$apply(function() {
      $scope.list = list;
    });
  }

  $http.get('/api/'+$scope.groupId+'/').success(function(res) {
    $scope.group = res;
  });

  $scope.list = $localStorage[$scope.listId];

  $scope.refresh_list = function() {
    $http.get('/api/'+$scope.groupId+'/lists/'+$scope.listId+'/').success(function(res) {
      $localStorage[$scope.listId] = res;
      $scope.list = res;
      console.log("List refreshed!");
    });
  };

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
    $http.post('/api/'+$scope.groupId+'/lists/'+$scope.listId+'/', null, {
      params: {
        'action': 'add',
        'item': $scope.new_item
      }
    }).success(function(res) {
      $scope.new_item = undefined;
    });
  }

  $scope.update_item = function(item) {
    $http.post('/api/'+$scope.groupId+'/lists/'+$scope.listId+'/', null, {
      params: {
        'action': 'update',
        'item': item.item,
	'amount': item.amount,
	'collected': item.collected
      }
    }).error(function(res) {
      $scope.refresh_list();
    });
  }

  $scope.move_item = function(e) {
    var original = e.detail.originalIndex;
    var splice = e.detail.spliceIndex;
    var item = $scope.list.items[original];
    $scope.list.items.splice(original, 1);
    $scope.list.items.splice(splice, 0, item);
    var prev = $scope.list.items[splice-1];
    var next = $scope.list.items[splice+1];
    $http.post('/api/'+$scope.groupId+'/lists/'+$scope.listId+'/', null, {
      params: {
        'action': 'reorder',
        'item': item ? item.item : undefined,
        'prev': prev ? prev.item : undefined,
        'next': next ? next.item : undefined
      }
    }).error(function(data, status, headers, config) {
      $scope.refresh_list();
    });
  };

  $scope.clear_collected = function() {
    var remaining = [];
    angular.forEach($scope.list.items, function(item) {
      if(!item.collected) {
        remaining.push(item);
      }
    });
    $scope.list.items = remaining;
    $http.post('/api/'+$scope.groupId+'/lists/'+$scope.listId+'/', null, {
      params: {
        'action': 'clear'
      }
    }).error(function(data, status, headers, config) {
      $scope.refresh_list();
    });
  }

  $scope.refresh_list();
  $scope.$on('awake', $scope.refresh_list);
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

