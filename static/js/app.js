'use strict';

var app = angular.module('shopping', ['ngRoute', 'ui.bootstrap']);

app.config(['$routeProvider', '$locationProvider', function($routeProvider, $locationProvider) {
  $locationProvider.html5Mode(true);

  $routeProvider.when('/:groupId', {
    templateUrl: '/static/partials/group.html',
    controller: 'GroupController'
  }).when('/:groupId/:listId', {
    templateUrl: '/static/partials/list.html',
    controller: 'ListController'
  });
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

  $scope.items = [];
  $scope.refresh_items = function() {
    $http.get('/api/'+$scope.groupId+'/lists/'+$scope.listId+'/').success(function(res) {
      $scope.items = res;
      console.log("Items refreshed!");
    });
  };

  $scope.refresh_items();

}]);
