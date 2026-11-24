"""Test-only proxy: sends www.instagram.com to the local HTTPS test server and refuses
everything else, so tests never touch the real website."""
import socket, threading, sys
LISTEN = int(sys.argv[1]); TARGET = ('127.0.0.1', int(sys.argv[2]))
ALLOWED = {'www.instagram.com'}

def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d: break
            b.sendall(d)
    except OSError: pass
    finally:
        for s in (a, b):
            try: s.close()
            except OSError: pass

def handle(c):
    try:
        head = b''
        while b'\r\n\r\n' not in head:
            d = c.recv(4096)
            if not d: return c.close()
            head += d
        line = head.split(b'\r\n')[0].decode()
        method, target = line.split(' ')[:2]
        host = target.split(':')[0]
        if method != 'CONNECT' or host not in ALLOWED:
            c.sendall(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return c.close()
        u = socket.create_connection(TARGET)
        c.sendall(b'HTTP/1.1 200 Connection established\r\n\r\n')
        threading.Thread(target=pipe, args=(c, u), daemon=True).start()
        pipe(u, c)
    except Exception:
        try: c.close()
        except OSError: pass

srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(('127.0.0.1', LISTEN)); srv.listen(64)
while True:
    conn, _ = srv.accept()
    threading.Thread(target=handle, args=(conn,), daemon=True).start()
