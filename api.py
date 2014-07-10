from controller import create_group, get_group
from google.appengine.ext import ndb
import webapp2
import json


class BaseHandler(webapp2.RequestHandler):
    def return_json(self, data):
        self.response.headers['Content-Type'] = 'application/json'
        self.response.write(json.dumps(data))


class GroupIndexHandler(BaseHandler):
    def post(self):
        group = create_group(self.request.get('label'))
        return webapp2.redirect(group.id + '/')


class GroupHandler(BaseHandler):
    def get(self, group_id):
        group = get_group(group_id)
        self.return_json(group.data)


class StoreHandler(BaseHandler):
    def get(self, group_id, store_id):
        store = get_group(group_id).store(store_id)
        self.return_json(store.data)


class ListIndexHandler(BaseHandler):
    def get(self, group_id):
        lists = get_group(group_id).lists
        result = map(lambda k, v: {'id': k, 'label': v}, lists.items())
        self.return_json(result)


class ListHandler(BaseHandler):
    def get(self, group_id, list_id):
        items = get_group(group_id).list(list_id).items
        self.return_json(map(lambda x: {
            'item': x.key.id(), 'amount': x.amount, 'collected': x.collected
        }, items))

    def post(self, group_id, list_id):
        _list = get_group(group_id).list(list_id)
        action = self.request.get('action')
        if action == 'add':
            item_id = self.request.get('item')
            amount = int(self.request.get('amount', '1'))
            _list.add_item(item_id, amount)
        elif action == 'remove':
            item_id = self.request.get('item')
            _list.remove_item(item_id)
        elif action == 'collect':
            item_id = self.request.get('item')
            _list.collect(item_id)
        elif action == 'clear':
            _list.clear()
        elif action == 'reorder':
            item_id = self.request.get('item')
            prev_item = self.request.get('prev')
            next_item = self.request.get('next')
            _list.reorder(item_id, prev_item, next_item)
        else:
            print "UNKNOWN ACTION: %r" % action


class IngredientHandler(BaseHandler):
    def post(self, group_id):
        result = get_group(group_id).autocomplete(self.request.get('query'))
        self.return_json(result)


application = webapp2.WSGIApplication([
    webapp2.Route('/api/create', GroupIndexHandler),
    webapp2.Route('/api/<group_id>/', handler=GroupHandler),
    webapp2.Route('/api/<group_id>/stores/<store_id>/', handler=StoreHandler),
    webapp2.Route('/api/<group_id>/lists/', handler=ListIndexHandler),
    webapp2.Route('/api/<group_id>/lists/<list_id>/', handler=ListHandler),
    webapp2.Route('/api/<group_id>/ingredients/', handler=IngredientHandler)
], debug=True)
