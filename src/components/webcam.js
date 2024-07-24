import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

// Create a context for the webcam stream
const WebcamContext = createContext(null)

export const useWebcam = () => useContext(WebcamContext)

export const WebcamProvider = ({ children }) => {
	const [stream, setStream] = useState(null)
	const [dim, setDim] = useState({ width: 640, height: 480 })
	const videoRef = useRef(null)

	// Memoize the webcam stream
	const memoizedStream = useMemo(() => {
		if (typeof window !== 'undefined') {
			return (async () => {
				try {
					console.log('getting cam')
					const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true })
					setStream(mediaStream)
					console.log('got cam', mediaStream)
					window.stream = mediaStream
					return mediaStream
				} catch (error) {
					console.error('Error accessing webcam:', error)
					return null
				}
			})()
		} else {
			return null
		}
	}, [])

	useEffect(() => {
		const setupStream = async () => {
			const mediaStream = await memoizedStream
			if (mediaStream && videoRef.current) {
				videoRef.current.srcObject = mediaStream
				videoRef.current.play()
				setDim({
					width: videoRef.current.width,
					height: videoRef.current.height,
				})
				console.log('got cam')
			}
		}
		setupStream()

		return () => {
			if (videoRef.current && videoRef.current.srcObject) {
				const tracks = videoRef.current.srcObject.getTracks()
				tracks.forEach((track) => track.stop())
			}
		}
	}, [memoizedStream])

	return (
		<WebcamContext.Provider value={{ stream, videoRef, dim }}>
			<div className="Cont">
				<video ref={videoRef}></video>
				<div className="right">
					<>{children}</>
				</div>
			</div>
		</WebcamContext.Provider>
	)
}
