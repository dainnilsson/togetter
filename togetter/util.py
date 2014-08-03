import string
from functools import wraps

CHARS = string.uppercase + string.lowercase + string.digits
CHARS_REV = dict((char, i) for (i, char) in enumerate(CHARS))
CHARS_BASE = len(CHARS)


def normalize(name):
    return name.strip().lower()


def encode_id(number):
    buf = []
    while number > 0:
        number, r = divmod(number, CHARS_BASE)
        buf.append(CHARS[r])
    return ''.join(buf)


def decode_id(encoded):
    number = 0
    pos = 0
    for digit in map(CHARS_REV.get, encoded):
        number += digit * (CHARS_BASE ** pos)
        pos += 1
    return number


def memoize(func):
    cache = {}

    @wraps(func)
    def wrap(*args):
        if args not in cache:
            cache[args] = func(*args)
        return cache[args]
    return wrap
