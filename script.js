import {
    FilesetResolver,
    HandLandmarker
} from "./node_modules/@mediapipe/tasks-vision/vision_bundle.mjs";

import * as pdfjsLib from "./node_modules/pdfjs-dist/build/pdf.mjs";

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
    "./node_modules/pdfjs-dist/build/pdf.worker.mjs";

// HTML elements
const video = document.querySelector("#camera");
const cameraPlaceholder = document.querySelector("#camera-placeholder");
const startCameraButton = document.querySelector(".start-camera");
const stopControllerButton = document.querySelector("#stop-controller");

const cameraStatus = document.querySelector("#camera-status");
const statusDot = document.querySelector("#status-dot");

const gestureIcon = document.querySelector("#gesture-icon");
const gestureName = document.querySelector("#gesture-name");
const gestureDescription = document.querySelector("#gesture-description");
const currentAction = document.querySelector("#current-action");

const presentationFile = document.querySelector("#presentation-file");
const fileName = document.querySelector("#file-name");
const pdfContainer = document.querySelector("#pdf-container");
const currentPageDisplay = document.querySelector("#current-page");

const nextSlideButton = document.querySelector("#next-slide");
const previousSlideButton = document.querySelector("#previous-slide");
const manualNextButton = document.querySelector("#manual-next-slide");
const manualPreviousButton = document.querySelector("#manual-previous-slide");

// Camera variables
let cameraStream = null;
let handLandmarker = null;
let detectionRunning = false;
let animationFrameId = null;
let lastVideoTime = -1;

// PDF variables
let pdfDocument = null;
let currentPage = 1;
let renderInProgress = false;
let pendingPage = null;

// Presentation state
let isPaused = false;

// Gesture cooldown
let lastGesture = "";
let lastGestureTime = 0;
const gestureDelay = 1500;

// Load MediaPipe
async function createHandLandmarker() {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "./node_modules/@mediapipe/tasks-vision/wasm"
        );

        handLandmarker = await HandLandmarker.createFromOptions(
            vision,
            {
                baseOptions: {
                    modelAssetPath:
                        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
                },
                runningMode: "VIDEO",
                numHands: 1,
                minHandDetectionConfidence: 0.6,
                minHandPresenceConfidence: 0.6,
                minTrackingConfidence: 0.6
            }
        );

        console.log("MediaPipe loaded successfully.");
        return handLandmarker;

    } catch (error) {
        console.error("MediaPipe loading error:", error);

        updateGestureDisplay(
            "⚠️",
            "Model Loading Failed",
            "Check your internet connection and browser Console.",
            "Model Error"
        );

        return null;
    }
}

const handLandmarkerPromise = createHandLandmarker();

// Update camera status
function setCameraStatus(message, color) {
    if (cameraStatus) {
        cameraStatus.textContent = message;
    }

    if (statusDot) {
        statusDot.style.backgroundColor = color;
    }
}

// Update gesture display
function updateGestureDisplay(icon, name, description, action) {
    if (gestureIcon) gestureIcon.textContent = icon;
    if (gestureName) gestureName.textContent = name;
    if (gestureDescription) {
        gestureDescription.textContent = description;
    }
    if (action && currentAction) {
        currentAction.textContent = action;
    }
}

// Start camera and controller
async function startCamera() {
    if (cameraStream || detectionRunning) {
        return;
    }

    if (!video) {
        alert('Video element "#camera" was not found.');
        return;
    }

    try {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(
                "Use Live Server or HTTPS to access the camera."
            );
        }

        if (startCameraButton) {
            startCameraButton.disabled = true;
            startCameraButton.textContent = "Connecting...";
        }

        if (stopControllerButton) {
            stopControllerButton.disabled = true;
        }

        setCameraStatus("Connecting...", "#f59e0b");

        const loadedLandmarker = await handLandmarkerPromise;

        if (!loadedLandmarker) {
            throw new Error("MediaPipe could not load.");
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        });

        video.srcObject = cameraStream;
        video.muted = true;
        video.playsInline = true;

        await video.play();

        if (cameraPlaceholder) {
            cameraPlaceholder.style.display = "none";
        }

        if (startCameraButton) {
            startCameraButton.disabled = true;
            startCameraButton.textContent = "✓ Controller Running";
            startCameraButton.style.backgroundColor = "#16a34a";
        }

        if (stopControllerButton) {
            stopControllerButton.disabled = false;
        }

        setCameraStatus("Connected", "#22c55e");

        lastVideoTime = -1;
        lastGesture = "";
        lastGestureTime = 0;
        detectionRunning = true;

        updateGestureDisplay(
            "✋",
            "No Gesture Detected",
            "Show one finger, two fingers, thumbs up, or a fist.",
            "Waiting..."
        );

        animationFrameId = requestAnimationFrame(detectHands);

    } catch (error) {
        console.error("Camera startup error:", error);

        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }

        if (video) {
            video.srcObject = null;
        }

        detectionRunning = false;

        if (startCameraButton) {
            startCameraButton.disabled = false;
            startCameraButton.textContent = "▶ Start Controller";
            startCameraButton.style.backgroundColor = "";
        }

        if (stopControllerButton) {
            stopControllerButton.disabled = true;
        }

        if (cameraPlaceholder) {
            cameraPlaceholder.style.display = "flex";
        }

        setCameraStatus("Connection Failed", "#ef4444");

        updateGestureDisplay(
            "⚠️",
            "Controller Failed",
            "Check camera permission and browser Console.",
            "Error"
        );

        alert("Could not start the controller:\n" + error.message);
    }
}

// Stop controller and release camera
function stopController() {
    detectionRunning = false;

    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    if (video) {
        video.pause();
        video.srcObject = null;
    }

    if (cameraPlaceholder) {
        cameraPlaceholder.style.display = "flex";
    }

    setCameraStatus("Not Connected", "#94a3b8");

    if (startCameraButton) {
        startCameraButton.disabled = false;
        startCameraButton.textContent = "▶ Start Controller";
        startCameraButton.style.backgroundColor = "";
    }

    if (stopControllerButton) {
        stopControllerButton.disabled = true;
    }

    lastGesture = "";
    lastGestureTime = 0;
    lastVideoTime = -1;

    updateGestureDisplay(
        "✊",
        "Controller Stopped",
        "The controller stopped. Click Start Controller to restart.",
        "Controller Stopped"
    );

    console.log("Controller stopped. Camera released.");
}

// Check whether a finger is raised
function isFingerUp(hand, tipIndex, jointIndex) {
    return hand[tipIndex].y < hand[jointIndex].y;
}

// Classify hand gestures
function classifyGesture(hand) {
    const indexUp = isFingerUp(hand, 8, 6);
    const middleUp = isFingerUp(hand, 12, 10);
    const ringUp = isFingerUp(hand, 16, 14);
    const pinkyUp = isFingerUp(hand, 20, 18);

    const fourFingersDown =
        !indexUp &&
        !middleUp &&
        !ringUp &&
        !pinkyUp;

    // Thumbs up: other four fingers curled and thumb raised
    const thumbUp =
        fourFingersDown &&
        hand[4].y < hand[3].y &&
        hand[4].y < hand[2].y;

    // Check thumbs up before fist
    if (thumbUp) {
        return "start";
    }

    // Fist: all four fingers curled, thumb not raised
    if (fourFingersDown) {
        return "stop";
    }

    // One finger = next slide
    if (
        indexUp &&
        !middleUp &&
        !ringUp &&
        !pinkyUp
    ) {
        return "next";
    }

    // Two fingers = previous slide
    if (
        indexUp &&
        middleUp &&
        !ringUp &&
        !pinkyUp
    ) {
        return "previous";
    }

    // Open palm = display only
    if (
        indexUp &&
        middleUp &&
        ringUp &&
        pinkyUp
    ) {
        return "open-palm";
    }

    return "unknown";
}

// Detect hands continuously
function detectHands() {
    if (!detectionRunning) return;

    try {
        if (
            handLandmarker &&
            video &&
            video.readyState >= 2 &&
            video.currentTime !== lastVideoTime
        ) {
            lastVideoTime = video.currentTime;

            const results = handLandmarker.detectForVideo(
                video,
                performance.now()
            );

            if (results.landmarks && results.landmarks.length > 0) {
                const hand = results.landmarks[0];
                const gesture = classifyGesture(hand);

                switch (gesture) {
                    case "next":
                        updateGestureDisplay(
                            "☝️",
                            "One Finger",
                            "Next slide gesture detected.",
                            "Next Slide"
                        );

                        performGesture("next");
                        break;

                    case "previous":
                        updateGestureDisplay(
                            "✌️",
                            "Two Fingers",
                            "Previous slide gesture detected.",
                            "Previous Slide"
                        );

                        performGesture("previous");
                        break;

                    case "start":
                        updateGestureDisplay(
                            "👍",
                            "Thumbs Up",
                            "Start or resume presentation navigation.",
                            "Start / Resume"
                        );

                        performGesture("start");
                        break;

                    case "stop":
                        updateGestureDisplay(
                            "✊",
                            "Fist",
                            "Stopping the controller and camera.",
                            "Controller Stopped"
                        );

                        stopController();
                        return;

                    case "open-palm":
                        updateGestureDisplay(
                            "✋",
                            "Open Palm",
                            "Open palm recognized; no action assigned.",
                            "Hand Detected"
                        );

                        lastGesture = "";
                        break;

                    default:
                        updateGestureDisplay(
                            "✋",
                            "Hand Detected",
                            "Try one finger, two fingers, thumbs up, or a fist.",
                            "Waiting..."
                        );

                        lastGesture = "";
                }

            } else {
                updateGestureDisplay(
                    "✋",
                    "No Gesture Detected",
                    "Place your hand clearly in front of the camera.",
                    "Waiting..."
                );

                lastGesture = "";
            }
        }

    } catch (error) {
        console.error("Hand detection error:", error);
    }

    if (detectionRunning) {
        animationFrameId = requestAnimationFrame(detectHands);
    }
}

// Prevent repeated slide actions
function performGesture(gesture) {
    const now = Date.now();

    if (
        gesture === lastGesture &&
        now - lastGestureTime < gestureDelay
    ) {
        return;
    }

    lastGesture = gesture;
    lastGestureTime = now;

    if (gesture === "next") {
        nextSlide();
    } else if (gesture === "previous") {
        previousSlide();
    } else if (gesture === "start") {
        startPresentation();
    }
}

// Pause presentation navigation
function pausePresentation() {
    isPaused = true;

    if (currentAction) {
        currentAction.textContent = "Paused";
    }

    if (pdfContainer) {
        pdfContainer.style.opacity = "0.5";
    }
}

// Start or resume presentation navigation
function startPresentation() {
    isPaused = false;

    if (currentAction) {
        currentAction.textContent = "Started / Resumed";
    }

    if (pdfContainer) {
        pdfContainer.style.opacity = "1";
    }
}

// Upload PDF
if (presentationFile) {
    presentationFile.addEventListener("change", async () => {
        const file = presentationFile.files?.[0];

        if (!file) return;

        if (
            file.type !== "application/pdf" &&
            !file.name.toLowerCase().endsWith(".pdf")
        ) {
            alert("Please select a PDF file.");
            presentationFile.value = "";
            return;
        }

        if (fileName) {
            fileName.textContent = file.name;
        }

        try {
            if (currentAction) {
                currentAction.textContent = "Loading PDF...";
            }

            const arrayBuffer = await file.arrayBuffer();

            const loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer
            });

            const loadedDocument = await loadingTask.promise;

            pdfDocument = loadedDocument;
            currentPage = 1;
            pendingPage = null;
            isPaused = false;

            if (pdfContainer) {
                pdfContainer.style.opacity = "1";
            }

            await showPDFPage(1);

            if (currentAction) {
                currentAction.textContent = "Presentation Ready";
            }

            console.log(
                "PDF loaded. Pages:",
                pdfDocument.numPages
            );

        } catch (error) {
            console.error("PDF loading error:", error);

            if (currentAction) {
                currentAction.textContent = "PDF Loading Failed";
            }

            alert("Could not load this PDF. Check the browser Console.");
        }
    });
}

// Render a PDF page
async function showPDFPage(pageNumber) {
    if (!pdfDocument) {
        if (currentAction) {
            currentAction.textContent = "Upload a PDF First";
        }
        return;
    }

    if (
        pageNumber < 1 ||
        pageNumber > pdfDocument.numPages
    ) {
        return;
    }

    if (renderInProgress) {
        pendingPage = pageNumber;
        return;
    }

    renderInProgress = true;

    try {
        let requestedPage = pageNumber;

        while (requestedPage !== null) {
            pendingPage = null;

            const page = await pdfDocument.getPage(requestedPage);
            const viewport = page.getViewport({ scale: 1.5 });

            const canvas = document.createElement("canvas");
            const context = canvas.getContext("2d");

            if (!context) {
                throw new Error("Could not create PDF canvas.");
            }

            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = "100%";
            canvas.style.height = "auto";
            canvas.style.display = "block";

            if (pdfContainer) {
                pdfContainer.replaceChildren(canvas);
                pdfContainer.style.display = "block";
            }

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            currentPage = requestedPage;
            updatePageDisplay();

            requestedPage = pendingPage;
        }

    } catch (error) {
        console.error("PDF page rendering error:", error);

        if (currentAction) {
            currentAction.textContent = "Page Rendering Error";
        }

    } finally {
        renderInProgress = false;
    }
}

// Update page number
function updatePageDisplay() {
    if (!currentPageDisplay) return;

    currentPageDisplay.textContent = pdfDocument
        ? `${currentPage} / ${pdfDocument.numPages}`
        : "1";
}

// Go to next slide
async function nextSlide() {
    if (!pdfDocument) {
        if (currentAction) {
            currentAction.textContent = "Upload a PDF First";
        }
        return;
    }

    if (isPaused) {
        if (currentAction) currentAction.textContent = "Paused";
        return;
    }

    if (currentPage >= pdfDocument.numPages) {
        if (currentAction) currentAction.textContent = "Last Slide";
        return;
    }

    await showPDFPage(currentPage + 1);

    if (currentAction) {
        currentAction.textContent = "Next Slide";
    }

    console.log("Moved to page:", currentPage);
}

// Go to previous slide
async function previousSlide() {
    if (!pdfDocument) {
        if (currentAction) {
            currentAction.textContent = "Upload a PDF First";
        }
        return;
    }

    if (isPaused) {
        if (currentAction) currentAction.textContent = "Paused";
        return;
    }

    if (currentPage <= 1) {
        if (currentAction) currentAction.textContent = "First Slide";
        return;
    }

    await showPDFPage(currentPage - 1);

    if (currentAction) {
        currentAction.textContent = "Previous Slide";
    }

    console.log("Moved to page:", currentPage);
}

// Connect PDF navigation buttons
nextSlideButton?.addEventListener("click", nextSlide);
previousSlideButton?.addEventListener("click", previousSlide);

manualNextButton?.addEventListener("click", nextSlide);
manualPreviousButton?.addEventListener("click", previousSlide);

// Connect camera buttons
startCameraButton?.addEventListener("click", startCamera);
stopControllerButton?.addEventListener("click", stopController);

// Initialize
updatePageDisplay();

if (stopControllerButton) {
    stopControllerButton.disabled = true;
}

console.log("GestureControl loaded successfully!");