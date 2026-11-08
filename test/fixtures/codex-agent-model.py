"""Synthetic Responses model that can request one explicitly scripted MCP tool."""
import json, os, uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

COMMAND=os.environ.get('TURNLINK_CODEX_FIXTURE_COMMAND','/tmp/turnlink-model-command.json')
CATALOGUE=os.environ.get('TURNLINK_CODEX_FIXTURE_CATALOGUE','/tmp/turnlink-model-tools.json')
PORT=int(os.environ.get('TURNLINK_CODEX_FIXTURE_PORT','42325'))

class Model(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        self.send_response(200);self.end_headers();self.wfile.write(b'{"data":[{"id":"fixture"}]}')

    def do_POST(self):
        length=int(self.headers.get('content-length','0'))
        if length>2*1024*1024:
            self.send_error(413);return
        request=json.loads(self.rfile.read(length));uid=uuid.uuid4().hex
        capture=os.environ.get('TURNLINK_CODEX_FIXTURE_CAPTURE')
        if capture:
            namespace=next((tool for tool in request.get('tools',[]) if tool.get('type')=='namespace' and tool.get('name')=='mcp__turnlink'),None)
            if namespace:
                control=next((tool for tool in namespace.get('tools',[]) if tool.get('name')=='channel_control'),None)
                if control:
                    fd=os.open(capture,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
                    with os.fdopen(fd,'w',encoding='utf-8') as out:json.dump({'namespace':namespace.get('name'),'description':namespace.get('description'),'tool':control},out,indent=2)
        catalogue=[]
        for tool in request.get('tools',[]):
            if tool.get('type')=='namespace':
                catalogue.extend({**entry,'namespace':tool.get('name')} for entry in tool.get('tools',[]))
            else:catalogue.append(tool)
        item={'id':'msg_'+uid,'type':'message','status':'completed','role':'assistant',
          'content':[{'type':'output_text','text':'Synthetic fixture completed.','annotations':[]}]}
        if os.path.exists(COMMAND) and 'TURNLINK_SYNTHETIC_TOOL_REQUEST' in json.dumps(request.get('input',[])):
            with open(COMMAND,encoding='utf-8') as source:command=json.load(source)
            os.unlink(COMMAND)
            found=next((tool for tool in catalogue if tool.get('name')==command['name'] and tool.get('namespace')=='mcp__turnlink'),None)
            if found:
                item={'id':'fc_'+uid,'type':'function_call','call_id':'call_'+uid,'name':found['name'],
                  'namespace':found['namespace'],'arguments':json.dumps(command['arguments']),'status':'completed'}
            else:
                with open(CATALOGUE,'w',encoding='utf-8') as out:
                    json.dump([{'name':tool.get('name'),'namespace':tool.get('namespace')} for tool in catalogue],out)
        result={'id':'resp_'+uid,'object':'response','created_at':1,'status':'completed','model':'fixture',
          'output':[item],'usage':{'input_tokens':1,'output_tokens':1,'total_tokens':2}}
        events=[('response.created',{'response':{**result,'status':'in_progress','output':[]}}),
          ('response.output_item.added',{'output_index':0,'item':{**item,'status':'in_progress'}})]
        if item['type']=='message':events.append(('response.output_text.delta',{'output_index':0,'content_index':0,'item_id':item['id'],'delta':'Synthetic fixture completed.'}))
        events.extend([('response.output_item.done',{'output_index':0,'item':item}),('response.completed',{'response':result})])
        body=''.join('event: '+kind+'\ndata: '+json.dumps({'type':kind,**payload})+'\n\n' for kind,payload in events).encode()
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)

server=HTTPServer(('127.0.0.1',PORT),Model)
if PORT==0:print(server.server_address[1],flush=True)
server.serve_forever()
