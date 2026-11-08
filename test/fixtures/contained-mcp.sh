while IFS= read -r line; do
  id=$(printf "%s" "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}}\n' "$id" ;;
    *'"method":"tools/list"'*) printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"detach","description":"start fixture child","inputSchema":{"type":"object","properties":{}}}]}}\n' "$id" ;;
    *'"method":"tools/call"'*) setsid sh -c 'exec sleep 300' </dev/null >/dev/null 2>&1 & printf '{"jsonrpc":"2.0","id":%s,"result":{"content":[{"type":"text","text":"started"}]}}\n' "$id" ;;
  esac
done
