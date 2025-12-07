If you dont have your IP exposed, you can create a tunnel from your localhost to the world using cloudflared.

If you don't have cloudflared installed yet please:
```{bash}
# Install cloudflared for Raspberrian
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm
sudo mv cloudflared-linux-arm /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared

# Check installation and login
cloudflared --version
cloudflared login
```

```{bash}
# Create a temporary tunnel. This command will output the address of your backend, modify your frontend to point to this address
cloudflared tunnel --url http://localhost:8080
```

To build and run,
```{bash}
docker compose up --build
```

Ideally, we should automate this process


Access to the frontend in:
- https://layyser.github.io/Whisper/frontend/