from togetter.api import (GroupIndexHandler, GroupHandler, StoreHandler,
                          ListIndexHandler, ListHandler)
import webapp2


class MainPage(webapp2.RequestHandler):

    def get(self):
        self.response.headers['Content-Type'] = 'text/plain'
        self.response.write('Hello, World!')


application = webapp2.WSGIApplication([
    ('/', MainPage),
    ('/api/create', GroupIndexHandler),
    webapp2.Route('/api/<group_id>/', handler=GroupHandler),
    webapp2.Route('/api/<group_id>/stores/<store_id>/', handler=StoreHandler),
    webapp2.Route('/api/<group_id>/lists/', handler=ListIndexHandler),
    webapp2.Route('/api/<group_id>/lists/<list_id>/', handler=ListHandler)
], debug=True)
