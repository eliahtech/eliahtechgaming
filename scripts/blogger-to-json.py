#!/usr/bin/env python3
"""Convert a Blogger Atom export to normalized JSON without executing embedded content."""
import argparse,json,re,xml.etree.ElementTree as ET
from urllib.parse import urlparse
p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('output');a=p.parse_args()
raw=open(a.input,'rb').read()
if len(raw)>100*1024*1024:raise SystemExit('Export exceeds 100 MB')
if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise SystemExit('XML entities are not accepted')
root=ET.fromstring(raw);ns={'a':'http://www.w3.org/2005/Atom'};out=[]
for entry in root.findall('a:entry',ns):
 kinds=[c.get('term','') for c in entry.findall('a:category',ns)]
 if not any(k.endswith('#post') for k in kinds):continue
 title=entry.findtext('a:title',default='',namespaces=ns)
 links=[l.get('href') for l in entry.findall('a:link',ns)if l.get('rel')=='alternate']
 slug=urlparse(links[0]).path.rsplit('/',1)[-1].removesuffix('.html') if links else re.sub(r'[^a-z0-9]+','-',title.lower()).strip('-')
 content=entry.findtext('a:content',default='',namespaces=ns)
 out.append({'title':title,'slug':slug,'content_html':content,'published_at':entry.findtext('a:published',namespaces=ns),'tags':[k for k in kinds if not k.startswith('http')],'source_url':links[0]if links else None,'status':'draft'})
open(a.output,'w').write(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print('Recovered',len(out),'posts as drafts; review before publishing.')
