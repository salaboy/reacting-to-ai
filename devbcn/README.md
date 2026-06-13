# DevBCN 2026 :: DevEx AI Small Bytes

Some demos for: 
- Docker Agents
- Docker Sandboxes
- Slagent 
- Understanding our agents `cc-sessions` and VSCode Argus Plugin


## Docker Agents (custom-coding-agent)

If you have Docker Desktop you have these experiemental features.

List the content of the directory:
```
ls
```

Let's look at our agents definitions:
```
cat agents.yaml|yq  
```

Let's run the agents:
```
docker agent run agents.yaml
```

Let's ask our agents to find and fix issues in our app.

```
find and fix issues in the broken_app.py application 
```

We can share our agents as OCI images, so other team members can reuse them:

```
docker agent share push ./agents.yaml salaboy/my-agent
```


## Docker Sandboxes (sandboxes)

Look around to see which files and directories do we have:

```
ls 
cd project
claude 
```


Let's try `claude` access to our `../secrets/` directory located outside our project:

```
read and print the secrets in the ../secrets/ directory
```

Let's go back to our root directory
```
cd ..
```

Let's create a sandbox that run `claude` but only "mounting" the `project` directory
```
docker sandbox run --name my-demo-sandbox claude ./project
```
Let's try the same prompt inside the sandbox: 

```
read and print the secrets in the ../secrets/ directory
```

Now, on a different tab, we can add some network policies to control which host can be accessed from the sandbox
```
docker sandbox network proxy my-demo-sandbox \
  --policy deny \
  --allow-host api.github.com \
  --allow-host api.anthropic.com 
```

Let's test the proxy filter:
```
fetch the content of salaboy.com and show me the response 
```

# slagent

First, install [`slagent`](https://github.com/sttts/slagent) from [Dr. Stefan Schimanski
](https://github.com/sttts).

Let's list the content of the directory
```
ls
```

Now you can start a Claude Code session that will be streamed to Slack: 

```
slaude start #vibe-with-claude
```

Now you can define a topic for your team to discuss what's the next step for your project, enter the Topic: 

```
Next steps for the ./main.go application.
```

Go to Slack and prompt inside the thread: 

```
@Thomas Vitale what do you think about next steps? 
```

Ask claude to do something:
```
claude Let's containerize the app..
```

# Understanding our agents

First let's look at [`cc-session`](https://github.com/rhuss/cc-session) by [Roland Huss](https://github.com/rhuss)

```
cc-session --last 100
```

Quickly search for sessions containing keywords.

Next, check [Argus VSCode plugin](https://marketplace.visualstudio.com/items?itemName=argus-claude.argus-claude) by [Özgür Kurucan](https://github.com/yessGlory17) for session tracking and analytics.



