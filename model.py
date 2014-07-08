from google.appengine.ext import ndb
from util import normalize


class Group(ndb.Model):  # Root entity
    label = ndb.StringProperty()
    default_store = ndb.KeyProperty(kind='Store')


class Ingredient(ndb.Model):  # Group as parent
    normalized = ndb.ComputedProperty(lambda self: normalize(self.id()))

    @classmethod
    def autocomplete(cls, group_key, query):
        if not query:
            return cls.query(ancestor=group_key).fetch(keys_only=True)
        start = normalized(query)
        end = start + u'\ufffd'
        return cls.query(ancestor=group_key) \
            .filter(cls.normalized >= start, cls.normalized < end) \
            .fetch(keys_only=True)


class Store(ndb.Model):  # Group as parent
    label = ndb.StringProperty()
    location = ndb.GeoPtProperty()


class Ordering(ndb.Model):  # Store as parent
    position = ndb.IntegerProperty(default=0)


class List(ndb.Model):  # Group as parent
    label = ndb.StringProperty()
    store = ndb.KeyProperty(kind=Store)


class Item(ndb.Model):  # List as parent
    amount = ndb.IntegerProperty(default=1)
    position = ndb.IntegerProperty(default=0)
    collected = ndb.BooleanProperty(default=False)
