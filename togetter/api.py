from togetter.controller import create_group, get_group, EntityNotFoundError
from google.appengine.api import channel
import webapp2
import json


class InvalidRequestError(Exception):
    pass


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
        self.return_json(get_group(group_id).data)

    def post(self, group_id):
        try:
            group = get_group(group_id)
            action = self.request.get('action')
            if action == 'create_list':
                _list = group.create_list(self.request.get('label'))
                return webapp2.redirect('lists/' + _list.id + '/')
            elif action == 'create_channel':
                client_id, token = group.create_listener()
                self.return_json({'token': token, 'client_id': client_id})
            elif action == 'ping_channel':
                channel.send_message(self.request.get('token'), 'pong')
            elif action == 'notify':
                group.notify(self.request.get('token'))
            else:
                raise InvalidRequestError('Unsupported action: %s' % action)
        except EntityNotFoundError, InvalidRequestError:
            self.abort(404)


class StoreHandler(BaseHandler):
    def get(self, group_id, store_id):
        self.return_json(get_group(group_id).store(store_id).data)


class ListIndexHandler(BaseHandler):
    def get(self, group_id):
        self.return_json(get_group(group_id).data)


class ListHandler(BaseHandler):
    def get(self, group_id, list_id):
        self.return_json(get_group(group_id).list(list_id).data)

    def post(self, group_id, list_id):
        try:
            group = get_group(group_id)
            _list = group.list(list_id)
            action = self.request.get('action')
            if action == 'add':
                item_id = self.request.get('item')
                amount = int(self.request.get('amount', '1'))
                _list.add_item(item_id, amount)
            elif action == 'remove':
                item_id = self.request.get('item')
                _list.remove_item(item_id)
            elif action == 'update':
                item = _list.item(self.request.get('item'))
                if 'collected' in self.request.arguments():
                    item.collected = json.loads(self.request.get('collected'))
                if 'amount' in self.request.arguments():
                    item.amount = int(self.request.get('amount'))
            elif action == 'clear':
                _list.clear()
            elif action == 'reorder':
                item_id = self.request.get('item')
                prev_item = self.request.get('prev')
                next_item = self.request.get('next')
                _list.reorder(item_id, prev_item, next_item)
            else:
                raise InvalidRequestError('Unsupported action: %s' % action)
            # Notify except token
            token = self.request.get('token', None)
            data = json.dumps(_list.data)
            for listener in group.listeners:
                if listener != token:
                    channel.send_message(listener, data)
        except EntityNotFoundError, InvalidRequestError:
            self.abort(404)


class IngredientHandler(BaseHandler):
    def get(self, group_id):
        result = get_group(group_id).autocomplete(self.request.get('query'))
        self.return_json(result)

    def post(self, group_id):
        try:
            group = get_group(group_id)
            ingredient = self.request.get('ingredient')
            action = self.request.get('action')
            if action == 'delete':
                group.remove_ingredient(ingredient)
            elif action == 'rename':
                new_name = self.request.get('new_name')
                group.rename_ingredient(ingredient, new_name)
            else:
                raise InvalidRequestError('Unsupported action: %s' % action)
        except EntityNotFoundError, InvalidRequestError:
            self.abort(404)


application = webapp2.WSGIApplication([
    webapp2.Route('/api/create', GroupIndexHandler),
    webapp2.Route('/api/<group_id>/', handler=GroupHandler),
    webapp2.Route('/api/<group_id>/stores/<store_id>/', handler=StoreHandler),
    webapp2.Route('/api/<group_id>/lists/', handler=ListIndexHandler),
    webapp2.Route('/api/<group_id>/lists/<list_id>/', handler=ListHandler),
    webapp2.Route('/api/<group_id>/ingredients/', handler=IngredientHandler)
], debug=True)
