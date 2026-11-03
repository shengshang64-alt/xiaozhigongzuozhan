# -*- coding: utf-8 -*-
import urllib.request, json
# probe: does app require auth? check a data endpoint
for url in ["http://127.0.0.1:8000/api/quotes?perPage=3","http://127.0.0.1:8000/"]:
    try:
        r=urllib.request.urlopen(url,timeout=6)
        body=r.read(300).decode("utf-8","replace")
        print(url,"->",r.status, body[:160].replace(chr(10)," "))
    except Exception as e:
        print(url,"ERR",repr(e)[:120])
