# -*- coding: utf-8 -*-
"""Petit serveur local : sert la page d'export et recoit le SVG rendu.

Tout reste sur la machine. Seule sortie vers l'exterieur : le script de rendu
de draw.io, charge depuis viewer.diagrams.net. Le diagramme, lui, ne quitte
jamais le poste.
"""
import http.server
import os
import socketserver

DOSSIER = os.path.dirname(os.path.abspath(__file__))
SORTIE = os.path.join(DOSSIER, "rendu.svg")
PORT = 8731


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=DOSSIER, **kw)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(n)
        with open(SORTIE, "wb") as f:
            f.write(data)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")
        print("SVG recu : %d octets" % len(data), flush=True)

    def log_message(self, *a):
        pass


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print("serveur pret sur http://127.0.0.1:%d" % PORT, flush=True)
    httpd.serve_forever()
