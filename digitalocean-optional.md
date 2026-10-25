# Guide 2 (optional): Run Gemma on a DigitalOcean server

Do **Guide 1 first**. This is the same thing, but Gemma runs on a rented DigitalOcean computer instead of your laptop.

**Why do this:** it uses DigitalOcean for the hackathon prize, and it works if your laptop is too slow.

**Trade-off:** page text would now travel to your server, so don't say "never leaves your machine" in the demo. Say "runs on a private server I control". The secure setup below keeps the server closed to everyone but you.

**Cost:** a Droplet (DigitalOcean's name for a server) costs a few cents per hour. **Delete it when you're done** (Step 9) so it stops charging.

---

## Step 1: Make a DigitalOcean account
1. Go to https://www.digitalocean.com and sign up.
2. Add a payment method. Check the hackathon page for free credits or a promo code.

## Step 2: Make an SSH key (your password to the server)
In Terminal on your Mac:
```sh
ssh-keygen -t ed25519
```
Press Enter at every question (accept the defaults, no passphrase is fine for a hackathon). Then show your public key:
```sh
cat ~/.ssh/id_ed25519.pub
```
Copy the whole line it prints (it starts with `ssh-ed25519`).

## Step 3: Create the Droplet
1. In DigitalOcean click **Create → Droplets**.
2. **Region:** the closest to you.
3. **Image:** Ubuntu (newest version).
4. **Size:** Basic, Regular CPU, **at least 8 GB RAM**. Smaller will run out of memory.
5. **Authentication:** choose **SSH Key → New SSH Key**, paste the line you copied, give it a name, save.
6. Click **Create Droplet**. Wait a minute, then copy its **IP address** (like `164.90.1.2`).

## Step 4: Connect to it
In Terminal (replace the IP with yours):
```sh
ssh root@YOUR_IP
```
Type `yes` if asked. The prompt changes to show you're now inside the server. Every command in Steps 5 to 7 runs there.

## Step 5: Install Ollama on the server
```sh
curl -fsSL https://ollama.com/install.sh | sh
```

## Step 6: Download Gemma on the server
```sh
ollama pull gemma4:e2b
```

## Step 7: Allow the Chrome extension
Still on the server, edit Ollama's settings:
```sh
systemctl edit ollama
```
An editor opens. Paste these lines in the empty area at the top:
```
[Service]
Environment="OLLAMA_ORIGINS=chrome-extension://*"
```
Save and exit (in nano: `Ctrl + O`, Enter, `Ctrl + X`). Then restart:
```sh
systemctl restart ollama
```
Type `exit` to leave the server.

## Step 8: Connect your Mac to the server safely (SSH tunnel)
This makes the server's Gemma look like it's on your own laptop, so **you don't change any extension code** and the server never opens to the internet.

1. Quit Ollama on your Mac (menu-bar llama icon, then Quit) so port 11434 is free.
2. In Terminal:
   ```sh
   ssh -N -L 11434:localhost:11434 root@YOUR_IP
   ```
3. It will look frozen. That's correct. **Leave it open** while you demo.
4. In a second Terminal window, test:
   ```sh
   curl http://localhost:11434/api/tags
   ```
   You should see `gemma4:e2b`. Your extension now uses the DigitalOcean Gemma.

## Step 9: Clean up when finished
1. In the DigitalOcean website go to your Droplet, then **Destroy**.
2. Confirm. Billing stops.

---

## If something goes wrong

| Problem | Fix |
|---|---|
| `Permission denied (publickey)` | The key you pasted in Step 3 was wrong. Re-run `cat ~/.ssh/id_ed25519.pub` and add it again |
| `address already in use` in Step 8 | Ollama is still running on your Mac. Quit it |
| Model download or run crashes | The Droplet is too small. Resize to 8 GB RAM or more |
| Extension gets a 403 | Redo Step 7 and make sure you ran `systemctl restart ollama` |
| First reply takes very long | Normal. The model loads into memory on the first request |

## For your submission
Mention: "Gemma 4 E2B (open-weight) served with Ollama on a DigitalOcean Droplet."
