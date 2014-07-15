'use strict';

var app = angular.module('shopping', ['ngRoute', 'ui.bootstrap']);

/*
 * Configuration
 */

app.config(['$routeProvider', '$locationProvider', function($routeProvider, $locationProvider) {
  $locationProvider.html5Mode(true);

  $routeProvider.when('/', {
    templateUrl: '/static/partials/index.html',
    controller: 'IndexController'
  }).when('/:groupId', {
    templateUrl: '/static/partials/group.html',
    controller: 'GroupController'
  }).when('/:groupId/:listId', {
    templateUrl: '/static/partials/list.html',
    controller: 'ListController'
  });
}]);

/*
 * Controllers
 */

app.controller('IndexController', ['$scope', '$location', function($scope, $location) {
  $scope.set_group = function(groupId) {
    $location.path('/'+groupId);
  }
}]);

app.controller('GroupController',
		['$scope', '$routeParams', '$http',
		function($scope, $routeParams, $http) {
  $scope.groupId = $routeParams.groupId;
  $http.get('/api/'+$scope.groupId+'/').success(function(res) {
    $scope.group = res
  });
}]);

app.controller('ListController',
		['$scope', '$routeParams', '$http',
		function($scope, $routeParams, $http) {
  $scope.groupId = $routeParams.groupId;
  $scope.listId = $routeParams.listId;

  $scope.list = [];

  $scope.refresh_items = function() {
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
      $scope.refresh_items();
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
      $scope.refresh_items();
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
      $scope.refresh_items();
    });
  };

  $scope.refresh_items();
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
  };
}]);

