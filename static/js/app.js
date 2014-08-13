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
    }).when('/:group_id', {
      templateUrl: '/static/partials/group.html',
      controller: 'GroupController',
      controllerAs: 'vm'
    }).when('/:group_id/:list_id', {
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
    return function(group_id, connected, onmessage) {
      var that = this;
      var storageKey = 'channel-'+group_id;
      
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
          $http.post('/api/'+group_id+'/', null, {
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
        $http.post('/api/'+group_id+'/', null, {
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
    return function(group_id) {
      var that = this;

      that.ingredients = [];

      that.add_ingredient = add_ingredient;
      that.remove_ingredient = remove_ingredient;
      that.filter = filter;
      
      refresh();

      function refresh() {
        $http.get('/api/'+group_id+'/ingredients/').success(function(res) {
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
    return function(group_id) {
      var that = this;
      var ingredientUrl = '/api/'+group_id+'/ingredients/';

      that.completer = new ItemCompleter(group_id);

      that.rename = rename_ingredient;
      that.delete = delete_ingredient;

      function rename_ingredient(old_name, new_name) {
        return $http.post(ingredientUrl, null, {
          params: {
            'action': 'rename',
            'ingredient': old_name,
            'new_name': new_name
          }
        }).then(function(resp) {
          that.completer.remove_ingredient(old_name);
          that.completer.add_ingredient(new_name);
          return resp;
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
    return function(group_id) {
      var that = this;
      var groupUrl = '/api/'+group_id+'/';
      
      that._lists = {};
      that.id = group_id;
      that.ingredients = new IngredientApi(group_id);
      that.channel = new Channel(group_id, on_connect, on_message);

      that.set_data = set_data;
      that.commit = commit;
      that.revert = revert;
      that.refresh = refresh;
      that.revert_and_refresh = revert_and_refresh;
      that.create_list = create_list;
      that.rename_list = rename_list;
      that.list = list;
      that.destroy = destroy;
  
      that.revert_and_refresh();

      function set_data(data) {
        that.data = data;
        that.commit();
      }
  
      function commit() {
        $localStorage[group_id] = angular.copy(that.data);
      }
  
      function revert() {
        that.data = angular.copy($localStorage[group_id]);
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

      function rename_list(list_id, new_name) {
        return that.list(list_id).rename(new_name).then(function() {
          for(var i=0; i<that.data.lists.length; i++) {
            if(that.data.lists[i].id == list_id) {
              that.data.lists[i].label = new_name;
              that.commit();
              break;
            }
          }
        });
      }
  
      function list(list_id) {
        if(!that._lists[list_id]) {
          that._lists[list_id] = new ListApi(that, list_id);
        }
        return that._lists[list_id];
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
    return function(group_id) {
      if($rootScope.group_api) {
        if($rootScope.group_api.data.id == group_id) {
          return $rootScope.group_api;
        }
        $rootScope.group_api.destroy();
      }
      $rootScope.group_api = new GroupApi(group_id);
      return $rootScope.group_api;
    }
  }
  
  services.factory('ListApi', ListApi);
  ListApi.$inject = ['$http', '$localStorage'];
  function ListApi($http, $localStorage) {
    return function(group_api, list_id) {
      var that = this;
      var listUrl = '/api/'+group_api.id+'/lists/'+list_id+'/';
      var storageKey = group_api.id+'/'+list_id;
  
      that.id = list_id;

      that.set_data = set_data;
      that.commit = commit;
      that.revert = revert;
      that.refresh = refresh;
      that.revert_and_refresh = revert_and_refresh;
      that.rename = rename;
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

      function rename(new_name) {
        return $http.post(listUrl, null, {
          params: {
            'action': 'rename',
            'new_name': new_name
          }
        }).success(function() {
          that.data.label = new_name;
          that.commit();
        });
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

    function set_group(group_id) {
      $location.path('/'+group_id);
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

    that.group_id = $routeParams.group_id;
    that.group = groupProvider(that.group_id);
    that.placeholder = [0,1,2,3,4,5,6,7,8,9];

    that.create_list = create_list;
    that.configure_store = configure_store;
    that.rename_list = rename_list;
    that.rename_ingredient = rename_ingredient;

    title.set(that.group.data ? that.group.data.label : 'Group');
    $localStorage.last = $location.path();
  
    function create_list(list_name) {
      that.group.create_list(list_name).then(function(list_id) {
        $location.path('/'+that.group_id+'/'+list_id);
      });
    }

    function configure_store(store) {
      $modal.open({
        templateUrl: '/static/partials/store.html',
        controller: 'StoreController as vm',
        resolve: {
          group_id: function() { return that.group_id },
          store: ['$http', function($http) {
            return $http.get('/api/'+that.group_id+'/stores/'+store.id+'/')
              .then(function(resp) { return resp.data });
          }]
        }
      });
    }

    function rename_list(list_id) {
      var list = that.group.list(list_id).data.label;
      $modal.open({
        templateUrl: '/static/partials/dialog-rename.html',
        controller: 'RenameController as vm',
        resolve: {
          name: function() { return list},
          title: function() { return 'List: '+list}
        }
      }).result.then(function(name) {
        that.group.rename_list(list_id, name);
      }, function(reason) {
        console.log('cancelled', reason);
      });
    }

    function rename_ingredient(ingredient) {
      $modal.open({
        templateUrl: '/static/partials/dialog-rename.html',
        controller: 'RenameController as vm',
        resolve: {
          name: function() { return ingredient },
          title: function() { return 'Ingredient: '+ingredient }
        }
      }).result.then(function(name) {
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
  
    that.group_id = $routeParams.group_id;
    that.list_id = $routeParams.list_id;
    that.group = groupProvider(that.group_id);
    that.list = that.group.list(that.list_id);

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
  StoreController.$inject = ['$modalInstance', '$http', 'group_id', 'store'];
  function StoreController($modalInstance, $http, group_id, store_data) {
    var that = this;
    console.log("store", store_data);
    var storeUrl = '/api/'+group_id+'/stores/'+store_data.id+'/';

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
  RenameController.$inject = ['$modalInstance', 'name', 'title'];
  function RenameController($modalInstance, name, title) {
    var that = this;

    that.title = title;
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

  directives.directive('autoselect', autoselect);
  autoselect.$inject = ['$timeout'];
  function autoselect($timeout) {
    return {
      restrict: 'A',
      link: link
    }

    function link(scope, element, attrs) {
      $timeout(function() { element[0].select() }, 100);
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

  directives.directive('scrollTo', scrollTo);
  scrollTo.$inject = ['$anchorScroll', '$location', '$window', '$interval'];
  function scrollTo($anchorScroll, $location) {
    return {
      restrict: 'A',
      link: link
    }

    function link(scope, element, attrs) {
      element.on('focus', function() {
        $location.hash(attrs.scrollTo);
        $anchorScroll();
      });
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
