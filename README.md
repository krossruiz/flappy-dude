# Flappy Dude

A browser Flappy Bird-style game where **your face is the bird**.

The front-facing camera is cropped to a consistent square and drawn as the character. Every run is recorded and uploaded to this machine’s server, then listed in a public **Community Log** of replays.

## Run

```bash
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Cameras and recording require `localhost` or HTTPS.

## How it plays

1. Read the camera & recording notice, enter a display name, and allow the webcam.
2. Press **Play**, then **space**, click, or tap to flap.
3. On crash, the session recording is saved to `data/recordings/` and appears in the community log.

Replays include the live face-square because they are captured from the game canvas.
