from togetter.model import (Group, List, Item, Store, Ordering, Ingredient,
                            Listener)
from togetter.util import encode_id, decode_id, normalize, memoize
from google.appengine.ext import ndb
from google.appengine.api import channel, memcache
from collections import OrderedDict
import json
import datetime
import logging


# Signed 64-bit integer
MAX_POS = (2 ** 63) - 1
MIN_POS = -(2 ** 63)

# Memcache keys
INGREDIENT = "_INGREDIENT"
LISTENERS = "_LISTENERS"


def channel_duration():
    now = datetime.datetime.utcnow() - datetime.timedelta(hours=7)  # PST
    expiry = datetime.datetime(now.year, now.month, now.day, 23, 59)
    if expiry <= now:
        expiry += datetime.timedelta(1)
    minutes = (expiry - now).seconds / 60
    if minutes < 10:
        minutes = 24*60
    logging.info("now: %r, minutes: %i" % (now, minutes))
    return minutes


def create_group(name):
    group = Group(label=name)
    group_key = group.put()
    group = get_group(encode_id(group_key.id()))
    store = group.create_store("Store")
    group.default_store = store.key
    group.create_list("My List")
    return group


@memoize
def get_group(group_id):
    return GroupController(ndb.Key(Group, decode_id(group_id)))


def clear_stale_listeners():
    earliest = datetime.datetime.now() - datetime.timedelta(hours=24)
    keys = Listener.query(Listener.created < earliest).fetch(keys_only=True)
    ndb.delete_multi(keys)


class EntityNotFoundError(Exception):

    def __init__(self, key):
        super(EntityNotFoundError, self).__init__(
            "Entity does not exist: %r" % key)
        self.key = key


class BaseController(object):

    def __init__(self, key, entity=None):
        self.key = key
        self._entity = entity

    @property
    @memoize
    def entity(self):
        entity = self.key.get()
        if not entity:
            raise EntityNotFoundError(self.key)
        return entity

    @property
    def id(self):
        return encode_id(self.key.id())

    @property
    def label(self):
        return self.entity.label

    @label.setter
    def label(self, value):
        self.entity.label = value
        self.entity.put()

    @property
    def data(self):
        return {
            'id': self.id,
            'label': self.label
        }


class GroupController(BaseController):

    def __init__(self, *args):
        super(GroupController, self).__init__(*args)

    @property
    def default_store(self):
        return self.entity.default_store

    @default_store.setter
    def default_store(self, value):
        self.entity.default_store = value
        self.entity.put()

    @property
    def lists(self):
        lists = List.query(ancestor=self.key) \
            .order(List.label).fetch(projection=[List.label])
        return OrderedDict([(encode_id(x.key.id()), x.label) for x in lists])

    @property
    def stores(self):
        stores = Store.query(ancestor=self.key) \
            .order(Store.label).fetch(projection=[Store.label])
        return OrderedDict([(encode_id(x.key.id()), x.label) for x in stores])

    @property
    def data(self):
        data = super(GroupController, self).data
        data.update({
            'lists': map(lambda (k, v): {'id': k, 'label': v},
                         self.lists.items()),
            'stores': map(lambda (k, v): {'id': k, 'label': v},
                          self.stores.items())
        })
        return data

    @memoize
    def list(self, list_id):
        return ListController(self, ndb.Key(List, decode_id(list_id),
                                            parent=self.key))

    @memoize
    def store(self, store_id):
        return StoreController(self, ndb.Key(Store, decode_id(store_id),
                                             parent=self.key))

    def create_list(self, label="My List"):
        _list = List(parent=self.key, label=label,
                     store=self.default_store)
        return self.list(encode_id(_list.put().id()))

    def create_store(self, label="Store"):
        store = Store(parent=self.key, label=label)
        return self.store(encode_id(store.put().id()))

    @property
    def ingredients(self):
        data = memcache.get(INGREDIENT, namespace=self.id)
        if data is None:
            keys = Ingredient.query(ancestor=self.key).fetch(keys_only=True)
            data = [key.id() for key in keys]
            memcache.set(INGREDIENT, data, namespace=self.id)
        return data

    def autocomplete(self, partial):
        if not partial:
            return self.ingredients
        q = Ingredient.query(ancestor=self.key)
        start = normalize(partial)
        end = start + u'\ufffd'
        q = q.filter(Ingredient.words >= start, Ingredient.words < end)
        return [x.id() for x in q.fetch(10, keys_only=True)]

    def remove_ingredient(self, ingredient):
        ndb.Key(Ingredient, ingredient, parent=self.key).delete()
        memcache.delete(INGREDIENT, namespace=self.id)

    def rename_ingredient(self, old_name, new_name):
        # Update Ingredients
        old_ingredient = ndb.Key(Ingredient, old_name, parent=self.key).get()
        if old_ingredient:
            old_ingredient.key.delete()
        Ingredient(parent=self.key, id=new_name).put()
        memcache.delete(INGREDIENT, namespace=self.id)

        # Update Stores
        store_keys = Store.query(ancestor=self.key).fetch(keys_only=True)
        order_keys = [ndb.Key(Ordering, old_name, parent=key) for key in
                      store_keys]
        old_orderings = [ordering for ordering in ndb.get_multi(order_keys)
                         if ordering is not None]
        new_orderings = []
        for ordering in old_orderings:
            new_ordering = ndb.Key(Item, new_name,
                                   parent=ordering.key.parent()).get()
            if not new_ordering:
                new_ordering = Ordering(
                    parent=ordering.key.parent(),
                    id=new_name)
                new_ordering.populate(**ordering.to_dict())
                new_orderings.append(new_ordering)
        ndb.delete_multi(map(lambda x: x.key, old_orderings))
        ndb.put_multi(new_orderings)

        # Update Lists
        list_keys = List.query(ancestor=self.key).fetch(keys_only=True)
        item_keys = [ndb.Key(Item, old_name, parent=key) for key in list_keys]
        old_items = [item for item in ndb.get_multi(item_keys)
                     if item is not None]
        new_items = []
        for item in old_items:
            new_item = ndb.Key(Item, new_name, parent=item.key.parent()).get()
            if new_item:  # Item already exists for new name, update amount
                if not item.collected:
                    new_item.amount = new_item.amount + item.amount
                    new_item.collected = False
            else:  # Item doesn't exist for new name, clone old Item
                new_item = Item(parent=item.key.parent(), id=new_name)
                new_item.populate(**item.to_dict())
            new_items.append(new_item)

            # List was modified, clear cache
            list_id = ListController(self, item.key.parent()).id
            memcache.delete(list_id, namespace=self.id)
        ndb.delete_multi(map(lambda x: x.key, old_items))
        ndb.put_multi(new_items)

    def create_listener(self):
        listener = Listener(parent=self.key)
        listener_key = listener.put()
        client_id = encode_id(listener_key.id())
        memcache.delete(LISTENERS, namespace=self.id)
        return client_id, channel.create_channel(
            client_id, duration_minutes=channel_duration())

    @property
    def listeners(self):
        data = memcache.get(LISTENERS, namespace=self.id)
        if data is None:
            data = [encode_id(key.id()) for key in
                    Listener.query(ancestor=self.key).fetch(keys_only=True)]
            memcache.set(LISTENERS, data, namespace=self.id)
        return data

    def notify(self, token):
        for _list in [self.list(key) for key in self.lists]:
            channel.send_message(token, json.dumps(_list.data))


class ListController(BaseController):

    def __init__(self, group, *args):
        super(ListController, self).__init__(*args)
        self.group = group

    @BaseController.label.setter
    def label(self, value):
        BaseController.label.fset(self, value)
        memcache.delete(self.id, namespace=self.group.id)

    @property
    def items(self):
        entities = Item.query(ancestor=self.key).order(Item.position).fetch()
        return [ItemController(self, entity.key, entity)
                for entity in entities]

    @property
    def store(self):
        return self.entity.store

    @store.setter
    def store(self, store_key):
        if self.entity.store == store_key:
            return

        self.entity.store = store_key
        items = dict([(item_e.key.id(), item_e) for item_e in
                      Item.query(ancestor=self.key).fetch()])
        order_keys = [
            ndb.Key(
                Ordering,
                item_id,
                parent=store_key) for item_id in items]
        order = ndb.get_multi(order_keys)
        updated_items = []
        for ordering in order:
            item = items[ordering.key.id()]
            if item and item.position != ordering.position:
                item.position = ordering.position
                updated_items.append(item)
        ndb.put_multi(updated_items)
        self.entity.put()
        memcache.delete(self.id, namespace=self.group.id)

    @property
    def data(self):
        data = memcache.get(self.id, namespace=self.group.id)
        if not data:
            data = super(ListController, self).data
            store = StoreController(self.group, self.store)
            data.update({
                'store': {'label': store.label, 'id': store.id},
                'items': [item.data for item in self.items]
            })
            memcache.set(self.id, data, namespace=self.group.id)
        return data

    def add_item(self, item_id, amount):
        ingredient = Ingredient.query(ancestor=self.group.key) \
            .filter(Ingredient.normalized == normalize(item_id)).get()
        if not ingredient:
            Ingredient(parent=self.group.key, id=item_id).put()
            memcache.delete(INGREDIENT, namespace=self.group.id)
        else:
            item_id = ingredient.key.id()

        item_key = ndb.Key(Item, item_id, parent=self.key)
        existing = item_key.get()
        if existing:
            if existing.collected:
                existing.collected = False
                existing.amount = amount
            else:
                existing.amount += amount
            existing.put()
        else:
            store = self.entity.store
            if store:
                ordering = Ordering.get_by_id(item_id, parent=store)
                if ordering:
                    pos = ordering.position
                else:
                    ordering = Ordering(parent=store, id=item_id)
                    last_item = Item.query(ancestor=self.key) \
                        .order(-Item.position). \
                        get(projection=[Item.position])
                    if last_item is None:
                        pos = 0
                    else:
                        pos = (last_item.position >> 1) + (MAX_POS >> 1)
                    ordering.position = pos
                    ordering.put()
            Item(
                parent=self.key,
                id=item_id,
                amount=amount,
                position=pos).put()
        memcache.delete(self.id, namespace=self.group.id)
        return self.item(item_id)

    @memoize
    def item(self, item_id):
        return ItemController(self, ndb.Key(Item, item_id, parent=self.key))

    def remove_item(self, item_id):
        ndb.Key(Item, item_id, parent=self.key).delete()
        memcache.delete(self.id, namespace=self.group.id)

    def reorder(self, item_id, prev=None, next=None):
        prev_pos = Item.get_by_id(prev, parent=self.key).position \
            if prev else MIN_POS
        next_pos = Item.get_by_id(next, parent=self.key).position \
            if next else MAX_POS
        item = Item.get_by_id(item_id, self.key)
        item.position = (prev_pos >> 1) + (next_pos >> 1)
        item.put()
        store = self.entity.store
        if store:
            ordering = Ordering.get_by_id(item_id, parent=store)
            ordering.position = item.position
            ordering.put()
            if next_pos - prev_pos < 5:
                StoreController(self.group, store).fix_spacing()
        memcache.delete(self.id, namespace=self.group.id)

    def clear(self):
        keys = Item.query(ancestor=self.key) \
            .filter(Item.collected == True) \
            .fetch(keys_only=True)
        ndb.delete_multi(keys)
        memcache.delete(self.id, namespace=self.group.id)


class ItemController(BaseController):

    def __init__(self, _list, *args):
        super(ItemController, self).__init__(*args)
        self.list = _list

    @property
    def id(self):
        return self.key.id()

    @property
    def collected(self):
        return self.entity.collected

    @collected.setter
    def collected(self, collected):
        if self.entity.collected != collected:
            self.entity.collected = collected
            self.entity.put()
            memcache.delete(self.list.id, namespace=self.list.group.id)

    @property
    def amount(self):
        return self.entity.amount

    @amount.setter
    def amount(self, amount):
        if self.entity.amount != amount:
            self.entity.amount = amount
            self.entity.put()
            memcache.delete(self.list.id, namespace=self.list.group.id)

    @property
    def data(self):
        return {
            'item': self.id,
            'amount': self.amount,
            'collected': self.collected
        }


class StoreController(BaseController):

    def __init__(self, group, *args):
        super(StoreController, self).__init__(*args)
        self.group = group

    def fix_spacing(self):
        order = Ordering.query(ancestor=self.key) \
            .order(Ordering.position).fetch()
        step = (MAX_POS - MIN_POS) / (len(order) + 1)
        for i, ordering in enumerate(order):
            ordering.position = MIN_POS + step * (i + 1)
        ndb.put_multi(order)
        list_keys = List.query(ancestor=self.group.key) \
            .filter(List.store == self.key).fetch(keys_only=True)
        if list_keys:
            order_table = dict(map(lambda x: (x.key.id(), x.position), order))
            for _list in [ListController(self.group, k) for k in list_keys]:
                items = Item.query(ancestor=_list.key).fetch()
                for item in items:
                    item.position = order_table[item.key.id()]
                ndb.put_multi(items)
                memcache.delete(_list.id, namespace=self.group.id)
