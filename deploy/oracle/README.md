# FlowPilot on Oracle Cloud, for free

This runs FlowPilot on an Oracle Cloud **Always Free** virtual machine: an Arm server with up to 2 OCPUs and 12 GB of memory, 200 GB of disk and 10 TB of traffic a month, at no cost. Oracle asks for a card when you create the account, but only to verify who you are: *"Your credit card will not be charged unless you upgrade your account"* ([Oracle's Free Tier docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)). As long as you never click **Upgrade** (to *Pay As You Go*), nothing can be billed.

What you end up with: `https://<your-address>` serving FlowPilot behind Caddy (automatic HTTPS certificate), the database on the VM's disk with a daily backup, and one command to update it.

Time needed: about 20 minutes, most of it waiting.

## 1. Create the account (once)

1. Go to [oracle.com/cloud/free](https://www.oracle.com/cloud/free/) and choose **Start for free**.
2. Fill in your details. Pick the **home region** carefully: it can't be changed later. For users in India, choose Mumbai or Hyderabad; otherwise the region closest to your users.
3. Verify your phone number and add a card. A small temporary authorization can appear on the statement and is released; it isn't a charge.
4. Wait for the "your account is ready" email (usually minutes, sometimes longer), then sign in at [cloud.oracle.com](https://cloud.oracle.com).

The account also comes with 30 days of trial credits. You don't need them: everything below is Always Free, and it keeps running after the trial ends.

## 2. Create the server

In the console: **☰ menu → Compute → Instances → Create instance**.

| Field | Choose |
|---|---|
| Name | `flowpilot` |
| Image | **Canonical Ubuntu 24.04** (click *Change image* if another image is selected) |
| Shape | *Change shape* → **Ampere** → **VM.Standard.A1.Flex**, marked *Always Free-eligible*; set **2 OCPUs** and **12 GB** of memory (or less: 1 OCPU and 6 GB is plenty) |
| Networking | Keep *Create new virtual cloud network* and *Create new public subnet*; make sure **Assign a public IPv4 address** is on |
| SSH keys | *Generate a key pair for me* and **download the private key**, or paste your own public key (`cat ~/.ssh/id_ed25519.pub`) |
| Boot volume | The default size is fine (it counts against the free 200 GB) |

Click **Create**. When the instance shows **Running**, copy its **Public IP address** from the instance page.

**"Out of host capacity"?** Free Arm capacity in a region is limited and this error is common. Try again with 1 OCPU / 6 GB, choose another *availability domain* on the create form, or retry later (people often succeed within a day). Don't switch the account to paid to get around it: that is the only way the card can ever be charged.

## 3. Open the web ports

Oracle's network blocks everything except SSH until you allow it (the script opens the VM's own firewall; this step is Oracle's).

1. On the instance page, under *Primary VNIC*, click the **subnet** link, then the **Default Security List**.
2. **Add Ingress Rules** and add two rules:
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port range **80**
   - Source CIDR `0.0.0.0/0`, IP protocol **TCP**, destination port range **443**

## 4. Deploy from your computer

From the project folder on your computer (macOS or Linux; on Windows use WSL):

```bash
# if Oracle generated the key for you:
chmod 600 ~/Downloads/ssh-key-*.key
SSH_KEY=~/Downloads/ssh-key-*.key deploy/oracle/push.sh ubuntu@<public-ip>

# if you pasted your own public key:
deploy/oracle/push.sh ubuntu@<public-ip>
```

The first run asks for your OpenRouter API key (for AI drafting; press Enter to skip, the app works without it, and you can add it later). It then installs Docker, opens the VM firewall, adds swap on small machines, builds the image (a few minutes), starts the app behind Caddy, schedules the daily backup, and prints the address, which looks like `https://129-146-1-2.sslip.io` ([sslip.io](https://sslip.io) turns the IP into a name so that a real certificate can be issued).

Open the address in a browser and sign up, or use the demo accounts. Then, from your computer, prove every endpoint works:

```bash
npm run smoke -- --base https://<your-address>
```

Your local `.env` and its keys are never copied to the server. The server keeps its own settings in `deploy/oracle/.env` (on the server, in `~/flowpilot/`), and that file is never overwritten by later deploys.

## 5. Day to day

| Task | How |
|---|---|
| Update to the latest code | `deploy/oracle/push.sh ubuntu@<public-ip>` again (about 30 seconds of downtime while the container restarts) |
| Change settings (registration, demo mode, AI key, email) | On the server: `sudo nano ~/flowpilot/deploy/oracle/.env`, then `sudo bash ~/flowpilot/deploy/oracle/setup.sh` |
| Use your own domain | Point an `A` record at the public IP, then `deploy/oracle/push.sh ubuntu@<public-ip> app.example.com`; Caddy fetches the certificate within a minute |
| Logs | `sudo docker compose -f ~/flowpilot/deploy/oracle/docker-compose.yml logs -f app` |
| Backup now | `sudo bash ~/flowpilot/deploy/oracle/backup.sh` (daily at 03:15 automatically, 14 kept, in `/srv/flowpilot/data/backups/`) |
| Copy a backup to your computer | `scp ubuntu@<public-ip>:/srv/flowpilot/data/backups/<file>.db .` |
| Keep the encryption key | Once: `sudo cat /srv/flowpilot/data/secret.key` and store it in a password manager. It encrypts two-step sign-in secrets and is deliberately not in the backups; to use it on a new server, put it back at the same path and `sudo chmod 600` it before the first start (the container fixes its owner) |
| Turn off two-step sign-in for someone locked out | After confirming who is asking: `cd ~/flowpilot/deploy/oracle && sudo docker compose exec -u node app node scripts/two-factor-off.mjs person@company.com` |
| Metrics for Prometheus | Add `METRICS_TOKEN=<a long random string>` to the server's `deploy/oracle/.env`, rerun `setup.sh`, and scrape `https://<your-address>/api/metrics` with that bearer token |
| Restore a backup | `cd ~/flowpilot/deploy/oracle && sudo docker compose stop app && sudo cp /srv/flowpilot/data/backups/<file>.db /srv/flowpilot/data/flowpilot.db && sudo rm -f /srv/flowpilot/data/flowpilot.db-wal /srv/flowpilot/data/flowpilot.db-shm && sudo docker compose start app` |

Run `npm run smoke` after an update. It signs up its own throwaway accounts (`smoke-<time>@example.com`) in their own workspace and never touches anyone else's data, so it's safe on a live server; the accounts stay behind, which is harmless.

## 6. Keeping it free

- **Idle VMs may be stopped.** Oracle's rule: an Always Free instance is idle when, over 7 days, CPU (95th percentile), network and memory are all under 20%, and *"idle Always Free compute instances may be reclaimed"* ([Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)). Oracle emails first; a reclaimed instance is stopped, not deleted ([Oracle community answer](https://community.oracle.com/customerconnect/discussion/671904/reclamation-of-idle-compute-instances)). To bring it back: **Compute → Instances → flowpilot → Start**. Docker restarts the app on boot, the certificate is kept, and the data is on the disk.
- **Stay on the Free Tier.** Only an upgrade to *Pay As You Go* lets Oracle bill the card. The free limits are far above what FlowPilot uses (about 120 MB of memory for the app and Caddy together).
- **The trial credits** expire after 30 days on their own; you never used them, so nothing changes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ssh: connect to host ... port 22: Connection timed out` | The instance isn't *Running*, or the IP is wrong |
| `Permission denied (publickey)` | Use the key you chose in step 2: `SSH_KEY=<path> deploy/oracle/push.sh ...`; the file must be `chmod 600`; the user is `ubuntu` |
| The script ends with "not reachable yet" | Usually step 3 (the security list). Check with `curl -I http://<public-ip>`: a redirect to https means the ports are open and only the certificate is pending. Caddy's log: `sudo docker compose -f ~/flowpilot/deploy/oracle/docker-compose.yml logs caddy` |
| Certificate errors on an sslip.io address | Let's Encrypt limits certificates per domain; switch to the twin service: `DOMAIN=<ip-with-dashes>.nip.io` and `APP_URL=https://...nip.io` in the server's `deploy/oracle/.env`, then rerun `setup.sh` |
| Build fails with "Killed" or out of memory | The VM is very small; the script adds swap, but 1 GB shapes are still tight. Use the A1 shape with at least 6 GB |
| "Too many accounts were created from here recently" during the smoke test | Sign-ups are limited per address; wait an hour or run the smoke test from another network |
