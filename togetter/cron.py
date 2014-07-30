from togetter.controller import clear_stale_listeners
import webapp2


class ClearListenersHandler(webapp2.RequestHandler):
    def get(self):
        clear_stale_listeners()

application = webapp2.WSGIApplication([
    webapp2.Route('/cron/clear_listeners/', ClearListenersHandler)
], debug=True)
