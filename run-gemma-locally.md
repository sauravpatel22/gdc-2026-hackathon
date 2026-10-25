# Guide 1: Run Gemma on your Mac (no experience needed)

Time: about 15 minutes, most of it waiting for a download.

**What you're doing:** installing a free app called Ollama, which runs AI models on your own computer. Then you download Gemma into it and talk to it.

Words you'll see:
- **Terminal**: a window where you type commands instead of clicking.
- **Model**: the AI "brain" file. Ours is `gemma4:e2b`, a small Gemma that runs on a laptop.
- **Server**: a program that sits and waits for requests. Your Chrome extension will send requests to it.

---

## Step 1: Open Terminal

1. Press `Cmd + Space`.
2. Type `Terminal` and press Enter.

A window with a blinking cursor opens. You'll paste commands here and press Enter to run them.

## Step 2: Install Ollama

Easy way (no Terminal):
1. Go to https://ollama.com/download
2. Click **Download for macOS**.
3. Open the downloaded file and drag Ollama into Applications.
4. Open Ollama once from Applications. A small llama icon appears in your menu bar at the top of the screen.

Check it worked. In Terminal, type:
```sh
ollama --version
```
You should see a version number. If it says "command not found", quit Terminal, open it again, and retry.

## Step 3: Download Gemma

In Terminal:
```sh
ollama pull gemma4:e2b
```
This downloads a few GB. Wait for it to say `success`.

If you get "model not found", check the exact name at https://ollama.com/library/gemma4 and use that name instead. Tell me the name if it differs, because the build guide uses `gemma4:e2b`.

## Step 4: Talk to Gemma

```sh
ollama run gemma4:e2b
```
Wait for a `>>>` prompt, then type a question and press Enter:
```
>>> Hi! Explain what you are in one sentence.
```
Gemma answers right in the window. Type `/bye` to leave the chat.

You've now used an open-weight model, entirely on your own machine.

## Step 5: Set it up for the Chrome extension

Your extension needs Ollama to accept requests from Chrome extensions, and it won't by default. Do this:

1. **Quit the Ollama menu-bar app**: click the llama icon, then **Quit Ollama**.
2. In Terminal, start the server with the permission turned on:
   ```sh
   OLLAMA_ORIGINS="chrome-extension://*" ollama serve
   ```
3. **Leave this window open.** It will print some text and sit there. That's normal, it's running. Closing it stops Gemma. You need to do steps 1 and 2 each time you restart your computer or reopen Terminal.

## Step 6: Test it like the extension will

Open a **second** Terminal window (`Cmd + N`) and paste:
```sh
curl http://localhost:11434/api/generate -d '{"model":"gemma4:e2b","prompt":"Is draftkings.com a gambling site? Answer yes or no.","stream":false}'
```
You'll get a block of text containing `"response":"Yes..."`. That's Gemma answering through the same door your extension will use.

Also check the server is up:
```sh
curl http://localhost:11434/api/tags
```
You should see `gemma4:e2b` in the list.

---

# Part 2: Understand Ollama and use it from code

Part 1 got Gemma running. This part explains what's going on underneath and how to use it like you'd use any hosted model API.

## Step 7: Understand what you just built

When you run `ollama serve`, Ollama starts a **web server** on your Mac. A web server is a program that waits for HTTP requests and sends back responses. It's the same idea as a hosted API from OpenAI or Anthropic, except it runs on your own machine.

```
Your Python script ──HTTP request──▶ Ollama server ──▶ Gemma model
(or Chrome extension)  localhost:11434   (loads the model, runs it)
                    ◀──HTTP response──
```

- **`localhost`** means "this computer". Requests never leave your Mac, so there's no internet, no API key, no per-token cost, and your prompts stay private.
- **`11434`** is the **port**, a numbered door on your computer. One machine can run many servers, and each one listens on a different port.
- **HTTP request**: a message sent to a URL. It has a method (usually `POST` when you send data), a URL (the **endpoint**), and a body (usually JSON).
- **JSON**: a text format for structured data, like `{"model": "gemma4:e2b", "prompt": "hi"}`. Python dictionaries map directly to it.
- **`curl`**: a Terminal tool that sends HTTP requests. Step 6 used it.

So you don't need Docker, a special SDK, or anything else. Any language that can send an HTTP request can talk to Gemma.

## Step 8: Call Gemma from Python

Install the `requests` library (a simple tool for sending HTTP requests):
```sh
pip install requests
```

### One-shot prompt: `/api/generate`

Use this when you send one prompt and want one answer, with no conversation memory.

```python
import requests

resp = requests.post(
    "http://localhost:11434/api/generate",
    json={
        "model": "gemma4:e2b",
        "prompt": "Is draftkings.com a gambling site? Answer yes or no.",
        "stream": False,  # False = wait and return the whole answer at once
    },
)
resp.raise_for_status()          # crash with a clear error if the server says something went wrong
print(resp.json()["response"])   # the model's text
```

This is the Step 6 `curl` command written in Python.

### Conversation: `/api/chat`

Use this when you want a system prompt or multi-turn conversation. It works like the chat APIs you may already know: a list of messages, each with a **role**.

- `system`: instructions that set the model's behavior ("You are a classifier...")
- `user`: what the person says
- `assistant`: what the model said earlier

```python
import requests

resp = requests.post(
    "http://localhost:11434/api/chat",
    json={
        "model": "gemma4:e2b",
        "messages": [
            {"role": "system", "content": "You classify websites. Reply with one word."},
            {"role": "user", "content": "draftkings.com"},
        ],
        "stream": False,
    },
)
print(resp.json()["message"]["content"])
```

### Important: the model has no memory

The server does **not** remember earlier requests. Every call starts fresh. To hold a conversation, you resend the whole history each time:

```python
history = [{"role": "system", "content": "You are a helpful assistant."}]

def ask(question):
    history.append({"role": "user", "content": question})
    resp = requests.post(
        "http://localhost:11434/api/chat",
        json={"model": "gemma4:e2b", "messages": history, "stream": False},
    )
    answer = resp.json()["message"]["content"]
    history.append({"role": "assistant", "content": answer})  # remember its reply too
    return answer

print(ask("My name is Elio."))
print(ask("What's my name?"))   # works because history was resent
```

### Streaming (words appear as they're generated)

By default (`"stream": true`), the server sends the answer in many small pieces, one JSON object per line, as the model generates it. This is how chat UIs show text appearing word by word. It feels much faster for long answers.

```python
import requests, json

with requests.post(
    "http://localhost:11434/api/chat",
    json={
        "model": "gemma4:e2b",
        "messages": [{"role": "user", "content": "Write a short poem about llamas."}],
        "stream": True,
    },
    stream=True,   # tells requests to read the response as it arrives
) as resp:
    for line in resp.iter_lines():
        if line:
            chunk = json.loads(line)
            print(chunk["message"]["content"], end="", flush=True)
            if chunk.get("done"):
                break
```

### Easier options: libraries

You can skip writing raw HTTP.

**Official Ollama Python library** (`pip install ollama`):
```python
import ollama

reply = ollama.chat(
    model="gemma4:e2b",
    messages=[{"role": "user", "content": "Hi!"}],
)
print(reply["message"]["content"])
```

**OpenAI-compatible endpoint.** Ollama also speaks the OpenAI API format at `/v1`. If you've used the OpenAI SDK (`pip install openai`), reuse that code and change two lines:
```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:11434/v1", api_key="ollama")  # key is ignored but required
reply = client.chat.completions.create(
    model="gemma4:e2b",
    messages=[{"role": "user", "content": "Hi!"}],
)
print(reply.choices[0].message.content)
```
This is useful because lots of tools and tutorials assume the OpenAI format, and they'll work with Gemma unchanged.

## Step 9: Control how the model answers

Add an `"options"` object to a request to tune generation:

```python
json={
    "model": "gemma4:e2b",
    "messages": [...],
    "stream": False,
    "options": {
        "temperature": 0,     # 0 = most predictable, 1+ = more random/creative
        "num_ctx": 4096,      # context window size (see below)
        "num_predict": 200,   # max tokens in the answer
        "seed": 42,           # same seed + temperature 0 = repeatable output
    },
}
```

Key concepts:

- **Token**: the unit models read and write. Roughly 3/4 of an English word. "Hello world" is about 2 tokens. Limits and speed are measured in tokens.
- **Temperature**: how much randomness the model uses when picking the next token. Use `0` for classification and extraction (you want consistent answers). Use `0.7` to `1.0` for writing and brainstorming.
- **Context window (`num_ctx`)**: how many tokens the model can "see" at once, including your prompt, the history, and its answer. If you send more than fits, the oldest text gets cut off and the model forgets it. Bigger windows use more memory and run slower. Ollama's default is small (a few thousand tokens), so raise it if you're sending long web pages.
- **System prompt**: standing instructions. Small models like `e2b` follow short, specific instructions much better than long, vague ones.

### Get structured answers (JSON)

If your code needs to parse the answer, ask for JSON instead of free text. Ollama can force the output to match a **schema** (a description of the shape you want):

```python
import json, requests

resp = requests.post(
    "http://localhost:11434/api/chat",
    json={
        "model": "gemma4:e2b",
        "messages": [{"role": "user", "content": "Classify the site: draftkings.com"}],
        "stream": False,
        "format": {
            "type": "object",
            "properties": {
                "is_gambling": {"type": "boolean"},
                "reason": {"type": "string"},
            },
            "required": ["is_gambling", "reason"],
        },
        "options": {"temperature": 0},
    },
)
result = json.loads(resp.json()["message"]["content"])
print(result["is_gambling"])   # True or False, ready to use in code
```

This is the single most useful trick for building apps on small models. Without it, small models sometimes add chatty text around the answer and break your parser.

## Step 10: Everyday Ollama commands

Run these in Terminal:

| Command | What it does |
|---|---|
| `ollama list` | Show models you've downloaded and their sizes |
| `ollama ps` | Show models currently loaded in memory |
| `ollama pull <name>` | Download a model |
| `ollama run <name>` | Chat with a model in Terminal |
| `ollama show <name>` | Show details: size, context length, capabilities |
| `ollama stop <name>` | Unload a model from memory |
| `ollama rm <name>` | Delete a model to free disk space |
| `ollama serve` | Start the server (the menu-bar app does this for you) |

**What "loaded" means:** a model file lives on disk. When a request arrives, Ollama loads it into memory (RAM, or GPU memory), which is why the first reply is slow. It then stays loaded for about 5 minutes after the last request, so later replies are fast. Change that per request with `"keep_alive": "30m"` (or `-1` to keep it forever).

**Model names:** `gemma4:e2b` has two parts: the family (`gemma4`) and the **tag** after the colon (`e2b`), which picks the size or variant. Browse tags at https://ollama.com/library. Bigger models are smarter but need more memory and run slower.

**Quantization:** model files are shrunk by storing numbers with less precision (for example 4-bit instead of 16-bit). That's why a model that would need 20 GB fits in 5 GB. You lose a little quality. Tags like `q4_K_M` or `q8_0` name the level. Ollama's defaults are a good balance, so you rarely need to choose.

**Where files live:** models are stored in `~/.ollama/models`. Check `ollama list` before downloading more, because they take several GB each.

## Step 11: Make your own model variant (Modelfile)

A **Modelfile** is a small recipe that bundles a base model with your own settings. It's useful for turning "Gemma with a long prompt" into a named model.

Create a file called `Modelfile` (no extension):
```
FROM gemma4:e2b
PARAMETER temperature 0
PARAMETER num_ctx 4096
SYSTEM """You decide whether a website is a gambling site. Reply with only YES or NO."""
```

Then build and use it:
```sh
ollama create gambling-checker -f Modelfile
ollama run gambling-checker
```

From Python, use `"model": "gambling-checker"` and the system prompt and settings are already applied.

## Step 12: What else Ollama can do

- **Embeddings** (`/api/embed`): turn text into a list of numbers that captures its meaning, so you can search by similarity. This needs an embedding model such as `nomic-embed-text`, not Gemma.
- **Tool calling**: you describe functions to the model, and it replies asking you to call one (for example `get_weather`). Your code runs the function and sends back the result. Only some models support it. Check with `ollama show <name>`.
- **Images and other inputs**: some Gemma variants can read images. Check the capabilities that `ollama show gemma4:e2b` lists before relying on it. For images, put base64-encoded images in a message's `"images"` list.
- **Network access**: by default the server only accepts connections from your own Mac. To let other devices on your network connect, set `OLLAMA_HOST=0.0.0.0` before `ollama serve`. Only do that on a network you trust, because Ollama has no login.

## Step 13: Should you use Docker?

You can run Ollama in Docker, and it will work. On a Mac I'd skip it:

1. **Docker on macOS can't use your Mac's GPU**, so the model runs on the CPU, much slower. The native app uses the GPU.
2. It adds another tool to install and debug, for no benefit on a laptop.

Docker makes sense when you deploy to a Linux server (see `digitalocean-optional.md`), where it gives you a repeatable setup. On a server, the command is:
```sh
docker run -d -p 11434:11434 -v ollama:/root/.ollama ollama/ollama
```
The Python code above works unchanged, you just replace `localhost` with the server's address.

## Step 14: Gotchas

- **Small models make mistakes.** `e2b` is fast and cheap but can be wrong or ignore instructions. Keep prompts short, use temperature 0, use the JSON `format` option, and check outputs in code.
- **"Connection refused" in Python** means the server isn't running. Start `ollama serve` or the menu-bar app, then check `curl http://localhost:11434/api/tags`.
- **Slow first request** is the model loading. Send a throwaway request at startup to warm it up.
- **Truncated or forgetful answers** usually mean the context window (`num_ctx`) is too small for your input.
- **`OLLAMA_ORIGINS` is only for browsers.** Chrome blocks extensions from calling servers unless the server grants permission, and that setting is the permission. Python and `curl` aren't browsers, so they work either way.
- **Where to read more:** the official API reference is at https://github.com/ollama/ollama/blob/main/docs/api.md.

---

## If something goes wrong

| Problem | Fix |
|---|---|
| `command not found: ollama` | Open the Ollama app once, then restart Terminal |
| `address already in use` when running `ollama serve` | The menu-bar app is still running. Quit it from the llama icon and retry |
| Extension gets a 403 error later | You started Ollama without `OLLAMA_ORIGINS`. Quit it and redo Step 5 |
| Very slow replies | Close other heavy apps. The first reply is always slowest while the model loads |
| Not enough disk space | Free up about 10 GB |
| Python says `Connection refused` | The server isn't running. Start Ollama and retry |
| Python says `model not found` | Run `ollama list` and use the exact name shown |

You're done with setup when Step 6 returns an answer. Steps 7 to 14 are for learning to use Ollama from code. Next: Step 1 of `Pause Claude Code Build Guide.pdf`.
