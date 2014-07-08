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
        self.return_json(map(lambda k, v: {'id': k, 'label': v}, lists.items()))


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
            existing = Item.get_by_id(item_id, parent=list_key)
            existing.collected = True
            existing.put()
        elif action == 'clear':
            keys = Item.query(ancestor=_list.list_key).fetch(keys_only=True)
            ndb.delete_multi(keys)
        elif action == 'reorder':
            item = self.request.get('item')
            prev_item = self.request.get('prev')
            next_item = self.request.get('next')
            _list.reorder(item, prev_item, next_item)
        else:
            print "UNKNOWN ACTION: %r" % action
