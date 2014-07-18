'use strict';

var app = angular.module('togetter', ['ngRoute', 'ngStorage', 'ui.bootstrap']);

/*
 * Configuration
 */

app.config(['$routeProvider', '$locationProvider', function($routeProvider, $locationProvider) {
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
  $location.path($localStorage.$default({last: '/welcome'}).last);
}]);

/*
 * Controllers
 */

app.controller('IndexController',
		['$location', '$localStorage',
		function($location, $localStorage) {
  console.log("hello");
  $location.path($localStorage.$default({last: '/welcome'}).last);
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

  if($localStorage.last) {
    $location.path($localStorage.last);
  }
}]);

app.controller('GroupController',
		['$scope', '$routeParams', '$http', '$localStorage', '$location',
		function($scope, $routeParams, $http, $localStorage, $location) {
  $scope.groupId = $routeParams.groupId;
  $http.get('/api/'+$scope.groupId+'/').success(function(res) {
    $localStorage.last = $location.path();
    $scope.group = res
  });
}]);

app.controller('ListController',
		['$scope', '$routeParams', '$http','$localStorage', '$location',
		function($scope, $routeParams, $http, $localStorage, $location) {
  $localStorage.last = $location.path();

  $scope.groupId = $routeParams.groupId;
  $scope.listId = $routeParams.listId;

  $http.get('/api/'+$scope.groupId+'/').success(function(res) {
    $scope.group = res;
  });

  $scope.list = [];

  $scope.refresh_list = function() {
    $http.get('/api/'+$scope.groupId+'/lists/'+$scope.listId+'/').success(function(res) {
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
      $scope.refresh_list();
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

