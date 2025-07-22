import React, { useState, useEffect, useRef } from 'react';

// --- Type Definitions for TypeScript ---
declare global {
    interface Window {
        faceapi: any;
        AudioContext: typeof AudioContext;
        webkitAudioContext: typeof AudioContext;
    }
}

interface Emotion {
    emotion: string;
    probability: number;
}

// --- Main App Component ---
const App: React.FC = () => {
    // --- State Variables ---
    const [modelsLoaded, setModelsLoaded] = useState<boolean>(false);
    const [captureVideo, setCaptureVideo] = useState<boolean>(false);
    const [isDetecting, setIsDetecting] = useState<boolean>(false);
    const [drowsinessStatus, setDrowsinessStatus] = useState<string>('Awake');
    const [emotions, setEmotions] = useState<Emotion[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [alertTriggered, setAlertTriggered] = useState<boolean>(false);
    const [currentEAR, setCurrentEAR] = useState<number>(0);
    const [noFaceCounter, setNoFaceCounter] = useState<number>(0);
    const [eyeClosedCounter, setEyeClosedCounter] = useState<number>(0);
    const [eyesOpenCounter, setEyesOpenCounter] = useState<number>(0); // New state for cooldown

    // --- Refs ---
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const videoHeight = 720;
    const videoWidth = 1280;

    // --- Detection Parameters ---
    const EYE_ASPECT_RATIO_THRESHOLD = 0.30;
    const EYE_AR_CONSEC_FRAMES = 30; 
    const EYES_OPEN_CONSEC_FRAMES = 5; // Cooldown: eyes must be open for ~1.5 seconds to reset

    // --- Mappings ---
    const emotionEmojiMap: { [key: string]: string } = {
        neutral: '😐',
        happy: '😊',
        sad: '😢',
        angry: '😠',
        fearful: '😨',
        disgusted: '🤢',
        surprised: '😮',
    };

    // --- Audio Alert Function ---
    const playAlertSound = () => {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
            gainNode.gain.setValueAtTime(0.5, audioContext.currentTime);
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.5);
        } catch (e) {
            console.error("Could not play sound:", e);
        }
    };
    
    // Effect to load models
    useEffect(() => {
        const loadModels = async () => {
            const faceapi = window.faceapi;
            if (!faceapi) {
                setError("face-api.js script not loaded. Please check index.html.");
                return;
            }
            const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights';
            try {
                await Promise.all([
                    faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
                    faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
                ]);
                setModelsLoaded(true);
            } catch (e) {
                setError("Failed to load detection models. Check internet connection.");
            }
        };
        loadModels();
    }, []);

    // Effect to trigger sound alert
    useEffect(() => {
        if (drowsinessStatus === 'Drowsy Alert!' && !alertTriggered) {
            playAlertSound();
            setAlertTriggered(true);
        }
    }, [drowsinessStatus, alertTriggered]);

    // --- Video and Detection Control ---
    const startVideo = () => {
        setCaptureVideo(true);
        setError(null);
        navigator.mediaDevices
            .getUserMedia({ video: { width: 1280, height: 720 } })
            .then(stream => {
                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                    videoRef.current.play();
                }
            })
            .catch(err => {
                setError("Could not access webcam. Please grant permission.");
                setCaptureVideo(false);
            });
    };

    const closeWebcam = () => {
        if (videoRef.current && videoRef.current.srcObject) {
            const stream = videoRef.current.srcObject as MediaStream;
            stream.getTracks().forEach(track => track.stop());
        }
        if (intervalRef.current) clearInterval(intervalRef.current);
        setCaptureVideo(false);
        setIsDetecting(false);
        setDrowsinessStatus('Awake');
        setEmotions([]);
        setEyeClosedCounter(0);
        setEyesOpenCounter(0);
        setAlertTriggered(false);
        setCurrentEAR(0);
        setNoFaceCounter(0);
    };

    const getEyeAspectRatio = (landmarks: any[]): number => {
        const v1 = Math.hypot(landmarks[1].y - landmarks[5].y, landmarks[1].x - landmarks[5].x);
        const v2 = Math.hypot(landmarks[2].y - landmarks[4].y, landmarks[2].x - landmarks[4].x);
        const h = Math.hypot(landmarks[0].y - landmarks[3].y, landmarks[0].x - landmarks[3].x);
        return (v1 + v2) / (2.0 * h);
    };

    const handleVideoOnPlay = () => {
        const faceapi = window.faceapi;
        if (!videoRef.current || !canvasRef.current || !modelsLoaded || !faceapi) return;

        setIsDetecting(true);
        intervalRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;

            if (canvasRef.current) {
                const detections = await faceapi.detectAllFaces(videoRef.current, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 })).withFaceLandmarks().withFaceExpressions();
                
                if (detections.length > 0) {
                    setNoFaceCounter(0);
                    const { expressions, landmarks } = detections[0];
                    const emotionArray: Emotion[] = Object.entries(expressions)
                        .map(([emotion, probability]): Emotion => ({ emotion, probability: probability as number }))
                        .sort((a, b) => b.probability - a.probability);
                    setEmotions(emotionArray);

                    const leftEye = landmarks.getLeftEye();
                    const rightEye = landmarks.getRightEye();
                    const avgEAR = (getEyeAspectRatio(leftEye) + getEyeAspectRatio(rightEye)) / 2.0;
                    setCurrentEAR(avgEAR);

                    if (avgEAR < EYE_ASPECT_RATIO_THRESHOLD) {
                        setEyesOpenCounter(0); // Reset open counter if eyes close
                        setEyeClosedCounter(prev => {
                            const newCount = prev + 1;
                            if (newCount >= EYE_AR_CONSEC_FRAMES) {
                                setDrowsinessStatus('Drowsy Alert!');
                            }
                            return newCount;
                        });
                    } else {
                        setEyeClosedCounter(0); // Reset closed counter if eyes open
                        setEyesOpenCounter(prev => {
                            const newCount = prev + 1;
                            // Only reset status to Awake after eyes have been open for a cooldown period
                            if (newCount >= EYES_OPEN_CONSEC_FRAMES) {
                                setDrowsinessStatus('Awake');
                                setAlertTriggered(false);
                            }
                            return newCount;
                        });
                    }
                } else {
                    setNoFaceCounter(prev => {
                        const newCount = prev + 1;
                        if (newCount > 60) {
                            setEmotions([]);
                            setDrowsinessStatus('No Face Detected');
                            setCurrentEAR(0);
                        }
                        return newCount;
                    });
                }
            }
        }, 333); 
    };

    const toggleDetection = () => {
        if (!captureVideo) startVideo();
        else closeWebcam();
    };
    
    useEffect(() => {
        const videoElement = videoRef.current;
        if (captureVideo && modelsLoaded && videoElement) {
            videoElement.addEventListener('play', handleVideoOnPlay);
            return () => {
                videoElement.removeEventListener('play', handleVideoOnPlay);
                if (intervalRef.current) clearInterval(intervalRef.current);
            };
        }
    }, [captureVideo, modelsLoaded]);

    const EmotionChart: React.FC<{ emotions: Emotion[] }> = ({ emotions }) => {
        if (!emotions || emotions.length === 0) return <div className="flex items-center justify-center h-full text-gray-500">Awaiting detection...</div>;
        const emotionColors: { [key: string]: string } = {
            neutral: 'bg-gray-400', happy: 'bg-yellow-400', sad: 'bg-blue-400',
            angry: 'bg-red-500', fearful: 'bg-purple-500', disgusted: 'bg-green-700',
            surprised: 'bg-pink-400',
        };
        return (
            <div className="w-full space-y-2">
                {emotions.map(({ emotion, probability }) => (
                    <div key={emotion} className="w-full">
                        <p className="text-sm font-medium text-gray-200 capitalize">{emotion}</p>
                        <div className="w-full bg-gray-700 rounded-full h-5">
                            <div className={`${emotionColors[emotion] || 'bg-gray-400'} h-5 rounded-full text-right pr-2 text-white text-xs flex items-center justify-end`} style={{ width: `${Math.round(probability * 100)}%` }}>
                                {`${Math.round(probability * 100)}%`}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    const dominantEmotion = emotions.length > 0 ? emotions[0].emotion : null;

    return (
        <div className="bg-gray-900 min-h-screen text-white font-sans flex flex-col items-center p-4 md:p-8">
            <div className="w-full max-w-7xl mx-auto">
                <header className="text-center mb-6">
                    <h1 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">Real-Time Emotion & Drowsiness Detection</h1>
                    <p className="text-gray-400 mt-2">Powered by React, TypeScript & face-api.js.</p>
                </header>

                {error && <div className="bg-red-800 border border-red-600 text-white px-4 py-3 rounded-lg relative mb-4 text-center" role="alert"><strong className="font-bold">Error: </strong><span className="block sm:inline">{error}</span></div>}

                <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 bg-gray-800 p-4 rounded-xl shadow-2xl border border-gray-700">
                        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                            <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center">
                                <video ref={videoRef} className="rounded-lg max-w-full max-h-full" style={{ display: captureVideo ? 'block' : 'none' }} crossOrigin="anonymous" />
                                <canvas ref={canvasRef} className="absolute top-0 left-0" />
                                {!captureVideo && <div className="text-center text-gray-400"><svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Webcam is off. Click start to begin.</div>}
                            </div>
                        </div>
                        <div className="mt-4 flex justify-center">
                            <button onClick={toggleDetection} disabled={!modelsLoaded && !error} className={`px-8 py-3 rounded-full font-semibold text-lg transition-all duration-300 ease-in-out transform hover:scale-105 ${(!modelsLoaded && !error) ? 'bg-gray-600 cursor-not-allowed' : captureVideo ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
                                {error ? 'Error Occurred' : !modelsLoaded ? 'Loading Models...' : captureVideo ? (isDetecting ? 'Stop Detection' : 'Starting...') : 'Start Detection'}
                            </button>
                        </div>
                    </div>

                    <div className="lg:col-span-1 bg-gray-800 p-6 rounded-xl shadow-2xl border border-gray-700 flex flex-col space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-300 mb-2 text-center">Drowsiness</h2>
                                <div className={`p-3 rounded-lg text-center text-xl font-bold ${drowsinessStatus === 'Drowsy Alert!' ? 'bg-red-500 animate-pulse' : drowsinessStatus === 'Awake' ? 'bg-green-500' : 'bg-gray-600'}`}>{drowsinessStatus}</div>
                                <p className="text-xs text-gray-400 text-center mt-2">EAR: {currentEAR.toFixed(2)}</p>
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-gray-300 mb-2 text-center">Emotion</h2>
                                <div className="p-3 rounded-lg text-center text-5xl bg-gray-700">{dominantEmotion ? emotionEmojiMap[dominantEmotion] : '🤔'}</div>
                            </div>
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-gray-300 mb-3 border-b-2 border-gray-700 pb-2">Emotion Analysis</h2>
                            <div className="h-64"><EmotionChart emotions={emotions} /></div>
                        </div>
                    </div>
                </main>
            </div>
        </div>
    );
};

export default App;
