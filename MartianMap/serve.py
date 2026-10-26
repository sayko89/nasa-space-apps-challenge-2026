#!/usr/bin/env python3
"""Martian Map — yerel başlatıcı. Uygulamayı http://127.0.0.1:<port>/ adresinde açar.
(index.html'e çift tıklamak çalışmaz: tarayıcı file:// üzerinden veri dosyalarını ve Web Worker'ı engeller.)"""
import functools, http.server, mimetypes, os, socket, sys, threading, webbrowser

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")
# Windows kayıt defteri .js'yi text/plain verebilir → ES modülleri yüklenmez. Açıkça ayarla.
for ext, typ in {".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
                 ".css": "text/css", ".svg": "image/svg+xml", ".bin": "application/octet-stream",
                 ".stl": "application/octet-stream", ".wasm": "application/wasm"}.items():
    mimetypes.add_type(typ, ext)


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json"}

    def log_message(self, *a):
        pass


def free_port(start=8765):
    for p in range(start, start + 50):
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    sys.exit("Boş port bulunamadı")


if __name__ == "__main__":
    port = free_port()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=APP))
    url = f"http://127.0.0.1:{port}/"
    print(f"Martian Map çalışıyor: {url}\nKapatmak için bu pencereyi kapatın (veya Ctrl+C).")
    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
