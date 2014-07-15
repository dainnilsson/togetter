from google.appengine.ext import ndb
from model import Group, List, Item, Store, Ordering, Ingredient
from util import encode_id, decode_id, normalize


# Signed 64-bit integer
MAX_POS = (2 ** 63) - 1
MIN_POS = -(2 ** 63)


def create_group(name):
    group = Group(label=name)
    group_key = group.put()
    group = get_group(encode_id(group_key.id()))
    store = group.create_store("Store")
    group.default_store = store.key
    group.create_list("My List")
    return group


def get_group(group_id):
    return GroupController(ndb.Key(Group, decode_id(group_id)))


class EntityNotFoundError(Exception):
    def __init__(self, key):
        super(EntityNotFoundError, self).__init__("Entity does not exist: %r" % key)
        self.key = key


class BaseController(object):

    def __init__(self, key, entity=None):
        self.key = key
        self._entity = entity

    @property
    def entity(self):
        if not self._entity:
            self._entity = self.key.get()
            if self._entity is None:
                raise EntityNotFoundError(self.key)
        return self._entity

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
        self._lists = {}
        self._stores = {}

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
            .fetch(projection=[List.label])
        return dict(map(lambda x: (encode_id(x.key.id()), x.label), lists))

    @property
    def stores(self):
        stores = Store.query(ancestor=self.key) \
            .fetch(projection=[Store.label])
        return dict(map(lambda x: (encode_id(x.key.id()), x.label), stores))

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

    def list(self, list_id):
        if list_id not in self._lists:
            _list = ListController(self, ndb.Key(List, decode_id(list_id),
                                                 parent=self.key))
            self._lists[list_id] = _list
            return _list
        return self._lists[list_id]

    def store(self, store_id):
        if store_id not in self._stores:
            store = StoreController(self, ndb.Key(Store, decode_id(store_id),
                                                  parent=self.key))
            self._stores[store_id] = store
            return store
        return self._stores[store_id]

    def create_list(self, label="My List"):
        _list = List(parent=self.key, label=label,
                     store=self.default_store)
        return self.list(encode_id(_list.put().id()))

    def create_store(self, label="Store"):
        store = Store(parent=self.key, label=label)
        return self.store(encode_id(store.put().id()))

    def autocomplete(self, partial):
        q = Ingredient.query(ancestor=self.key)
        if partial:
            start = normalize(partial)
            end = start + u'\ufffd'
            q = q.filter(Ingredient.words >= start,
                         Ingredient.words < end)
        return map(lambda x: x.id(), q.fetch(10, keys_only=True))


class ListController(BaseController):

    def __init__(self, group, *args):
        super(ListController, self).__init__(*args)
        self.group = group
        self._items = {}

    @property
    def items(self):
        entities = Item.query(ancestor=self.key).order(Item.position).fetch()
        return [ItemController(self, entity.key, entity) for entity in entities]

    @property
    def store(self):
        return self.entity.store

    @store.setter
    def store(self, store_key):
        self.entity.store = store_key
        items = Item.query(ancestor=self.key).fetch()
        order_keys = [
            ndb.Key(
                Ordering,
                x.id(),
                parent=store_key) for x in items]
        order = ndb.get_multi(order_keys)
        for item, ordering in zip(items, order):
            item.position = ordering.position
        ndb.put_all(items)
        self.entity.put()

    @property
    def data(self):
        data = super(ListController, self).data
        store = StoreController(self.group, self.store)
        data.update({
            'store': {'label': store.label, 'id': store.id},
            'items': [item.data for item in self.items]
        })
        return data

    def add_item(self, item_id, amount):
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
            if not Ingredient.query(ancestor=self.group.key) \
                    .filter(Ingredient.normalized == normalize(item_id)).get():
                Ingredient(parent=self.group.key, id=item_id).put()
        return self.item(item_id)

    def item(self, item_id):
        if item_id not in self._items:
            item = ItemController(self, ndb.Key(Item, item_id,
                                                parent=self.key))
            self._items[item_id] = item
            return item
        return self._items[item_id]

    def remove_item(self, item_id):
        ndb.Key(Item, item_id, parent=self.key).delete()

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

    def clear(self):
        keys = Item.query(ancestor=self.key).fetch(keys_only=True)
        ndb.delete_multi(keys)


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
        self.entity.collected = collected
        self.entity.put()

    @property
    def amount(self):
        return self.entity.amount

    @amount.setter
    def amount(self, amount):
        self.entity.amount = amount
        self.entity.put()

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
        lists = List.query(ancestor=self.group.key) \
            .filter(List.store == self.key).fetch()
        if lists:
            order_table = dict(map(lambda x: (x.key.id(), x.position), order))
            for _list in lists:
                items = Item.query(ancestor=_list.key).fetch()
                for item in items:
                    item.position = order_table[item.key.id()]
                ndb.put_multi(items)
