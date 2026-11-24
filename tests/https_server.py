"""Small HTTPS static server for the tests (self-signed certificate)."""
import http.server, ssl, sys, os
port = int(sys.argv[1]); root = sys.argv[2]; certs = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'certs')
os.chdir(root)
httpd = http.server.ThreadingHTTPServer(('127.0.0.1', port), http.server.SimpleHTTPRequestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(os.path.join(certs, 'cert.pem'), os.path.join(certs, 'key.pem'))
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
httpd.serve_forever()
