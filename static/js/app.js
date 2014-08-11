'use strict';
  
(function() {
  /*
   * Module
   */
  
  var module = angular.module('togetter', ['services', 'controllers', 'directives', 'filters',
  'ngRoute', 'ngStorage', 'ui.bootstrap', 'xeditable', 'ngAnimate']);
  
  module.config(config);
  config.$inject = ['$routeProvider', '$locationProvider'];
  function config($routeProvider, $locationProvider) {
    $locationProvider.html5Mode(true);
  
    $routeProvider.when('/', {
      resolve: { redirect: 'IndexRedirector' }
    }).when('/welcome', {
      templateUrl: '/static/partials/welcome.html',
      controller: 'WelcomeController',
      controllerAs: 'vm'
    }).when('/:groupId', {
      templateUrl: '/static/partials/group.html',
      controller: 'GroupController',
      controllerAs: 'vm'
    }).when('/:groupId/:listId', {
      templateUrl: '/static/partials/list.html',
      controller: 'ListController',
      controllerAs: 'vm'
    });
  }

  module.run(run);
  run.$inject = ['editableOptions', 'editableThemes'];
  function run(editableOptions, editableThemes) {
    editableOptions.theme = 'bs3';
    editableOptions.activate = 'select';
    editableOptions.buttons = 'no';

    editableThemes.bs3.inputClass = 'input-xs';
    editableThemes.bs3.buttonsClass = 'btn-xs';
  }
  
  /*
   * Services
   */

  var services = angular.module('services', ['directives']);
  services.factory('title', title);
  title.$inject = ['$rootScope'];
  function title($rootScope) {
    return {
      get: get,
      set: set
    }

    function get() {
      return $rootScope.title;
    }

    function set(title_value) {
      $rootScope.title = title_value;
    }
  }
  
  services.factory('IndexRedirector', IndexRedirector);
  IndexRedirector.$inject = ['$location', '$localStorage'];
  function IndexRedirector($location, $localStorage) {
    $location.path($localStorage.last || '/welcome');
  }
  
  services.factory('activityMonitor', activityMonitor);
  activityMonitor.$inject = ['$window', '$document', '$rootScope'];
  function activityMonitor($window, $document, $rootScope) {
    var mon = {
      latest: Date.now(),
      threshold: 30000,
      touch: touch
    };

    angular.element($document)
      .on('visibilitychange msvisibilitychange mozvisibilitychange webkitvisibilitychange', mon.touch);
    angular.element($window)
      .on('online focus touchmove mousemove mousedown mousewheel keydown DOMMouseScroll', mon.touch);
    return mon;
  
    function touch() {
      var now = Date.now();
      if(now - mon.latest > mon.threshold) {
        console.log("Return from idle!");
        $rootScope.$broadcast('awake');
      }
      mon.latest = now;
    }
  }
  
  services.factory('Channel', Channel);
  Channel.$inject = ['$rootScope', '$localStorage', '$http', '$timeout', 'activityMonitor'];
  function Channel($rootScope, $localStorage, $http, $timeout, activityMonitor) {
    return function(groupId, connected, onmessage) {
      var that = this;
      var storageKey = 'channel-'+groupId;
      
      that.close = close;
      that.reconnect = reconnect;
      that.ping = ping;

      $rootScope.$on('awake', that.ping);
      that.reconnect();
  
      function close() {
        console.log("Channel closed");
        that.reconnect = undefined;
        clearTimeout(that.timeout);
        if(that.socket) {
          that.socket.onclose = undefined;
          that.socket.close();
        }
      }
  
      function reconnect() {
        if(!$localStorage[storageKey]) {
          $http.post('/api/'+groupId+'/', null, {
            params: {'action': 'create_channel'}
          }).success(function(res) {
            $localStorage[storageKey] = {'token': res.token, 'client_id': res.client_id};
            that.reconnect();
          }).error(function(data, status, headers, config) {
            console.log("Error subscribing");
            that.timeout = $timeout(that.reconnect, 10000, true);
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
      }
  
      function ping() {
        $http.post('/api/'+groupId+'/', null, {
          params: {'action': 'ping_channel', 'token': that.client_id}
        }).success(function() {
          that.timeout = $timeout(that.reconnect, 5000, true);
        }).error(function() {
          console.log("Detected broken channel, reconnect...");
          if(that.socket) {
            that.socket.close();
          }
        });
      }
    };
  }
  
  services.factory('ItemCompleter', ItemCompleter);
  ItemCompleter.$inject = ['$http'];
  function ItemCompleter($http) {
    return function(groupId) {
      var that = this;

      that.ingredients = [];

      that.add_ingredient = add_ingredient;
      that.remove_ingredient = remove_ingredient;
      that.filter = filter;
      
      refresh();

      function refresh() {
        $http.get('/api/'+groupId+'/ingredients/').success(function(res) {
          that.ingredients = res;
        });
      }
    
      function add_ingredient(ingredient) {
        that.ingredients.push(ingredient);
        that.ingredients.sort();
      }

      function remove_ingredient(ingredient) {
        var index = that.ingredients.indexOf(ingredient);
	if(index != -1) {
	  that.ingredients.splice(index, 1);
	}
      }
  
      function filter(partial) {
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
      }
    };
  }

  services.factory('IngredientApi', IngredientApi);
  IngredientApi.$inject = ['$http', 'ItemCompleter'];
  function IngredientApi($http, ItemCompleter) {
    return function(groupId) {
      var that = this;
      var ingredientUrl = '/api/'+groupId+'/ingredients/';

      that.completer = new ItemCompleter(groupId);

      that.rename = rename_ingredient;
      that.delete = delete_ingredient;

      function rename_ingredient(old_name, new_name) {
        return $http.post(ingredientUrl, null, {
          params: {
            'action': 'rename',
            'ingredient': old_name,
            'new_name': new_name
          }
        }).success(function() {
          that.completer.remove_ingredient(old_name);
          that.completer.add_ingredient(new_name);
	});
      }

      function delete_ingredient(name) {
        return $http.post(ingredientUrl, null, {
          params: {
            'action': 'delete',
            'ingredient': name
          }
        });
      }
    }
  }

  services.factory('GroupApi', GroupApi);
  GroupApi.$inject = ['$localStorage', '$http', 'ListApi', 'Channel', 'IngredientApi'];
  function GroupApi($localStorage, $http, ListApi, Channel, IngredientApi) {
    return function(groupId) {
      var that = this;
      var groupUrl = '/api/'+groupId+'/';
      
      that._lists = {};
      that.id = groupId;
      that.ingredients = new IngredientApi(groupId);
      that.channel = new Channel(groupId, on_connect, on_message);

      that.set_data = set_data;
      that.commit = commit;
      that.revert = revert;
      that.refresh = refresh;
      that.revert_and_refresh = revert_and_refresh;
      that.create_list = create_list;
      that.list = list;
      that.destroy = destroy;
  
      that.revert_and_refresh();

      function set_data(data) {
        that.data = data;
        that.commit();
      }
  
      function commit() {
        $localStorage[groupId] = angular.copy(that.data);
      }
  
      function revert() {
        that.data = angular.copy($localStorage[groupId]);
      }
  
      function refresh() {
        $http.get(groupUrl).success(that.set_data);
      }
  
      function revert_and_refresh() {
        that.revert();
        that.refresh();
      }
  
      function create_list(list_name) {
        return $http.post(groupUrl, null, {
          params: {
            'action': 'create_list',
            'label': list_name
          }
        }).then(function(resp) {
          return that.list(resp.data.id).id;
        });
      }
  
      function list(listId) {
        if(!that._lists[listId]) {
          that._lists[listId] = new ListApi(that, listId);
        }
        return that._lists[listId];
      }
  
      function destroy() {
        console.log("destructor");
        that.channel.close();
      }
  
      function on_connect() {
        console.log('reconnect');
        for(var list_id in that._lists) {
          that.list(list_id).refresh();
        }
      }
      
      function on_message(list_data) {
        console.log("Remote modification!", list_data);
        that.list(list_data.id).set_data(list_data);
        for(var i=0; i<list_data.items.length; i++) {
          var item = list_data.items[i];
          if(that.ingredients.completer.ingredients.indexOf(item.item) == -1) {
            that.ingredients.completer.add_ingredient(item.item);
          }
        }
      }
    };
  }
  
  services.factory('groupProvider', groupProvider);
  groupProvider.$inject = ['$rootScope', 'GroupApi'];
  function groupProvider($rootScope, GroupApi) {
    return function(groupId) {
      if($rootScope.group_api) {
        if($rootScope.group_api.data.id == groupId) {
          return $rootScope.group_api;
        }
        $rootScope.group_api.destroy();
      }
      $rootScope.group_api = new GroupApi(groupId);
      return $rootScope.group_api;
    }
  }
  
  services.factory('ListApi', ListApi);
  ListApi.$inject = ['$http', '$localStorage'];
  function ListApi($http, $localStorage) {
    return function(group_api, listId) {
      var that = this;
      var listUrl = '/api/'+group_api.id+'/lists/'+listId+'/';
      var storageKey = group_api.id+'/'+listId;
  
      that.id = listId;

      that.set_data = set_data;
      that.commit = commit;
      that.revert = revert;
      that.refresh = refresh;
      that.revert_and_refresh = revert_and_refresh;
      that.add_item = add_item;
      that.update_item = update_item;
      that.move_item = move_item;
      that.clear_collected = clear_collected;
  
      that.revert_and_refresh();

      function set_data(data) {
        that.data = data;
        that.commit();
      }
  
      function commit() {
        $localStorage[storageKey] = angular.copy(that.data);
      }
  
      function revert() {
        that.data = angular.copy($localStorage[storageKey]);
      }
  
      function refresh() {
        console.log("Refresh list: "+that.id);
        $http.get(listUrl).success(that.set_data);
      }
  
      function revert_and_refresh() {
        that.revert();
        that.refresh();
      }
  
      function add_item(item) {
        return $http.post(listUrl, null, {
          params: {
            'action': 'add',
            'item': item,
            'token': group_api.channel.client_id
          }
        }).success(function() {
          group_api.ingredients.completer.add_ingredient(item);
          that.refresh();
        });
      }
  
      function update_item(item) {
        return $http.post(listUrl, null, {
          params: {
            'action': 'update',
            'item': item.item,
            'amount': item.amount,
            'collected': item.collected,
            'token': group_api.channel.client_id
          }
        }).success(that.commit).error(that.revert_and_refresh);
      }
  
      function move_item(index, splice) {
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
      }
  
      function clear_collected() {
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
      }
    };
  }
  
  /*
   * Controllers
   */
  
  var controllers = angular.module('controllers', ['services']);
  controllers.controller('IndexController', IndexController);
  IndexController.$inject = ['$location', '$localStorage'];
  function IndexController($location, $localStorage) {
    $location.path($localStorage.last || '/welcome');
  }
  
  controllers.controller('WelcomeController', WelcomeController);
  WelcomeController.$inject = ['$location', '$http', '$localStorage', 'title'];
  function WelcomeController($location, $http, $localStorage, title) {
    var that = this;
    
    that.set_group = set_group;
    that.create_group = create_group;

    title.set('welcome');

    function set_group(groupId) {
      $location.path('/'+groupId);
    }
  
    function create_group(group_name) {
      $http.post('/api/create', null, {
        params: {'label': group_name}
      }).success(function(data) {
        $location.path('/'+data.id);
      });
    }
  }
  
  controllers.controller('GroupController', GroupController);
  GroupController.$inject = ['$routeParams', '$http', '$localStorage', '$location', '$modal', 'groupProvider', 'title'];
  function GroupController($routeParams, $http, $localStorage, $location, $modal, groupProvider, title) {
    var that = this;

    that.groupId = $routeParams.groupId;
    that.group = groupProvider(that.groupId);
    that.placeholder = [0,1,2,3,4,5,6,7,8,9];

    that.create_list = create_list;
    that.configure_store = configure_store;
    that.rename_ingredient = rename_ingredient;

    title.set(that.group.data ? that.group.data.label : 'Group');
    $localStorage.last = $location.path();
  
    function create_list(list_name) {
      that.group.create_list(list_name).then(function(listId) {
        $location.path('/'+that.groupId+'/'+listId);
      });
    }

    function configure_store(store) {
      $modal.open({
        templateUrl: '/static/partials/store.html',
        controller: 'StoreController as vm',
        resolve: {
          groupId: function() { return that.groupId },
          store: ['$http', function($http) {
            return $http.get('/api/'+that.groupId+'/stores/'+store.id+'/')
              .then(function(resp) { return resp.data }, function() {});
          }]
        }
      });
    }

    function rename_ingredient(ingredient) {
      $modal.open({
        templateUrl: '/static/partials/dialog-rename.html',
        controller: 'RenameController as vm',
        resolve: {
          name: function() { return ingredient }
        }
      }).result.then(function(name) {
        console.log('rename', ingredient, name);
	that.group.ingredients.rename(ingredient, name);
      }, function(reason) {
        console.log('cancelled', reason);
      });
    }

  }
  
  controllers.controller('ListController', ListController);
  ListController.$inject = ['$scope', '$routeParams', '$http', '$location', '$localStorage', 'groupProvider', 'title'];
  function ListController($scope, $routeParams, $http, $location, $localStorage, groupProvider, title) {
    var that = this;
  
    that.groupId = $routeParams.groupId;
    that.listId = $routeParams.listId;
    that.group = groupProvider(that.groupId);
    that.list = that.group.list(that.listId);

    that.filter_items = that.group.ingredients.completer.filter;
    that.add_item = add_item;
    that.move_item = move_item;
    that.update_item = that.list.update_item;
    that.clear_collected = that.list.clear_collected;
    that.increment_amount = increment_amount;
    that.decrement_amount = decrement_amount;

    $scope.$on('awake', that.list.refresh);
    title.set(that.list.data ? that.list.data.label : 'List');
    $localStorage.last = $location.path();
  
    function add_item(item) {
      that.new_item = undefined;
      that.list.add_item(item).then(undefined, function() {
        that.new_item = item;
      });
    }
  
    function increment_amount(item) {
      item.amount++;
      that.list.update_item(item);
    }

    function decrement_amount(item) {
      if(item.amount > 1) {
        item.amount--;
        that.list.update_item(item);
      }
    }
  
    function move_item(e) {
      that.list.move_item(e.detail.originalIndex, e.detail.spliceIndex);
    }
  }
  
  controllers.controller('StoreController', StoreController);
  StoreController.$inject = ['$modalInstance', '$http', 'groupId', 'store'];
  function StoreController($modalInstance, $http, groupId, store_data) {
    var that = this;
    console.log("store", store_data);
    var storeUrl = '/api/'+groupId+'/stores/'+store_data.id+'/';

    that.store = store_data;
    that.set_label = set_label;
    that.set_position = set_position;
    that.set_default = set_default;
    that.delete_store = delete_store;

    function set_label() {
      $http.post(storeUrl, undefined, {
        params: {
  'action': 'rename',
          'label': that.store.label
}
      }).success($modalInstance.$close).error(function() {
console.log('Error updating label');
      });
    }
    function set_position(pos) {}
    function set_default() {}
    function delete_store() {}
  }

  controllers.controller('RenameController', RenameController);
  RenameController.$inject = ['$modalInstance', 'name'];
  function RenameController($modalInstance, name) {
    var that = this;

    that.name = name;
    that.save_name = save_name;
    that.dismiss = $modalInstance.dismiss;

    function save_name() {
      if(that.name != name) {
        $modalInstance.close(that.name);
      } else {
        $modalInstance.dismiss('Name unchanged');
      }
    }
  }

  /*
   * Directives
   */
  
  var directives = angular.module('directives', ['filters', 'ui.bootstrap']);
  directives.directive('reorderable', reorderable);
  reorderable.$inject = ['$parse'];
  function reorderable($parse) {
    return {
      restrict: 'A',
      link: link
    }

    function link(scope, element, attrs) {
      var slip = new Slip(element[0]);

      element.on('slip:reorder', function(event) {
        event.target.parentNode.insertBefore(event.target, event.detail.insertBefore);
        scope.$apply(function() {
          $parse(attrs.onReorder)(scope, {$event:event});
        });
      });

      element.on('slip:beforewait', function(event) {
        if(event.target.className.indexOf('slip-instant') > -1) {
          event.preventDefault();
        }
      });

      element.on('slip:beforeswipe', function(event) {
        event.preventDefault();
      });

      element.on('$destroy', function() { slip.detach() });
    }
  }
  
  directives.directive('selectOnFocus', selectOnFocus);
  selectOnFocus.$inject = [];
  function selectOnFocus() {
    return {
      restrict: 'A',
      link: link
    }

    function link(scope, element, attrs) {
      element.on('click', element[0].select);
    }
  }

  directives.directive('pagelist', pagelist);
  pagelist.$inject = ['startFromFilter'];
  function pagelist(startFrom) {
    return {
      restrict: 'E',
      templateUrl: '/static/partials/pagelist.html',
      transclude: 'element',
      replace: true,
      require: ['pagelist', '?ngModel'],
      scope: {
        model: '=ngModel',
        padding: '@padding'
      }
    }
  }

  /*
   * Filters
   */

  var filters = angular.module('filters', []);
  filters.filter('startFrom', startFrom);
  startFrom.$inject = [];
  function startFrom() {
    return function(input, start) {
      start = +start; //parse to int
      return input.slice(Math.max(0, start));
    }
  }
})();
