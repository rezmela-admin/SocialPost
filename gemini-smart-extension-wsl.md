# Smart Model‑Picker Extension (Gemini CLI, WSL Ubuntu)

Follow the 4 commands below‑—that’s all.

```bash
# 1.  Create extension folder
mkdir -p ~/.gemini/extensions/smart && cd $_

# 2.  Manifest
cat > gemini-extension.json <<'EOF'
{ "name": "smart", "version": "1.0.0", "command": "./smart.sh" }
EOF

# 3.  Script (auto‑chooses model by token count)
cat > smart.sh <<'EOF'
#!/usr/bin/env bash
PROMPT="$*"
TOKENS=$(printf '%s' "$PROMPT" | gemini tokens)
if   (( TOKENS <= 4096 ));    then MODEL="gemini-2.5-flash-lite"
elif (( TOKENS <= 131072 ));  then MODEL="gemini-2.5-pro"
else                               MODEL="gemini-1.5-pro"
fi
[[ -n "$GEMINI_FORCE_MODEL" ]] && MODEL="$GEMINI_FORCE_MODEL"
exec gemini -m "$MODEL" --max-output-tokens 512 "$PROMPT"
EOF
chmod +x smart.sh

# 4.  Launch Gemini CLI, then use:
#     smart "your prompt"
```

**Override model on demand**

```bash
GEMINI_FORCE_MODEL=gemini-2.5-pro smart "deep reasoning request"
unset GEMINI_FORCE_MODEL
```

That’s it—Gemini CLI loads the extension automatically on start.
