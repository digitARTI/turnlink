"""Minimal local-only Responses API for an isolated native Codex test."""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer

class Model(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b'{"data":[{"id":"fixture"}]}')

    def do_POST(self):
        length=int(self.headers.get('content-length','0'))
        if length>2*1024*1024:
            self.send_error(413); return
        self.rfile.read(length)
        item={'id':'msg_synthetic','type':'message','status':'completed','role':'assistant',
          'content':[{'type':'output_text','text':'Synthetic fixture completed.','annotations':[]}]}
        result={'id':'resp_synthetic','object':'response','created_at':1,'status':'completed','model':'fixture',
          'output':[item],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}
        events=[('response.created',{'response':{**result,'status':'in_progress','output':[]}}),
          ('response.output_item.added',{'output_index':0,'item':{**item,'status':'in_progress','content':[]}}),
          ('response.output_text.delta',{'output_index':0,'content_index':0,'item_id':item['id'],'delta':'Synthetic fixture completed.'}),
          ('response.output_item.done',{'output_index':0,'item':item}),('response.completed',{'response':result})]
        body=''.join('event: '+kind+'\ndata: '+json.dumps({'type':kind,**payload})+'\n\n' for kind,payload in events).encode()
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

HTTPServer(('127.0.0.1',42325),Model).serve_forever()
