import { Test } from '@/hooks/useLiveImage2'
import * as fal from '@fal-ai/serverless-client'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import './style.css'
import { useWebcam } from './webcam'
async function updateDrawing({ fetchImage, imageUrl, prompt }) {
	try {
		// startedIteration += 1
		// const iteration = startedIteration

		// prevHash = hash
		// prevPrompt = frame.props.name

		// const prompt = 'A robot with long hair inside a room sitting at his desk in a gaming chair'

		const result = await fetchImage({
			prompt,
			image_url: imageUrl,
			sync_mode: true,
			strength: 0.65,
			seed: 1, // Math.abs(random() * 10000), // TODO make this configurable in the UI
			enable_safety_checks: false,
		})
		return result
		console.log(result)
		// cancel if stale:
		// if (iteration <= finishedIteration) return

		// finishedIteration = iteration
	} catch (e) {
		const isTimeout = e instanceof Error && e.message === 'Timeout'
		if (!isTimeout) {
			console.error(e)
		}
	}
}

export function View({ appId }) {
	const [fetchImage, setFetchImage] = useState({ current: null })
	const [count, setCount] = useState(0)
	const [doDraw, setDoDraw] = useState(false)

	const { stream, videoRef } = useWebcam()
	const [dataUrl, setDataUrl] = useState(null)
	const canvasRef = useRef()
	const canvasRef2 = useRef()
	const inputRef = useRef()

	const captureFrame = () => {
		const canvas = canvasRef.current
		console.log('ref', canvasRef, stream, videoRef)
		if (!canvas || !videoRef) {
			return console.log('missing')
		}
		canvas.width = videoRef.current.videoWidth
		canvas.height = videoRef.current.videoHeight
		const context = canvas.getContext('2d')
		context.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)
		const dataUrl = canvas.toDataURL('image/png')
		// setDataUrl(dataUrl);
		return dataUrl
	}

	useEffect(() => {
		const requestsById = new Map()

		const { send, close } = fal.realtime.connect(appId, {
			connectionKey: 'fal-realtime-example',
			clientOnly: false,
			throttleInterval: 64, //throttleTime,
			onError: (error) => {
				console.error(error)
				// force re-connect
				setCount((count) => count + 1)
			},
			onResult: (result) => {
				if (result.images && result.images[0]) {
					const id = result.request_id
					const request = requestsById.get(id)
					if (request) {
						request.resolve(result.images[0])
					}
				}
			},
		})

		console.log(' SET FETCH IMAGE')
		setFetchImage({
			current: (req) => {
				return new Promise((resolve, reject) => {
					console.log('FETCH REQ', req)
					const id = uuid()

					const timeoutTime = 5000
					const timer = setTimeout(() => {
						requestsById.delete(id)
						reject(new Error('Timeout'))
					}, timeoutTime)
					requestsById.set(id, {
						resolve: (res) => {
							console.log('resolve', res)
							resolve(res)
							clearTimeout(timer)
						},
						reject: (err) => {
							reject(err)
							clearTimeout(timer)
						},
						timer,
					})
					const url = captureFrame()
					if (url) {
						req.image_url = url
						console.log('can has URL')
					}

					send({ ...req, request_id: id })
				})
			},
		})

		return () => {
			for (const request of requestsById.values()) {
				request.reject(new Error('Connection closed'))
			}
			try {
				close()
			} catch (e) {
				// noop
			}
		}
	}, [appId])

	const draw = async (_) => {
		const d = await updateDrawing({
			fetchImage: fetchImage.current,
			imageUrl: captureFrame(),
			prompt: inputRef.current.value,
		})
		const c = canvasRef2.current
		if (!d) return
		const { width, height, url } = d
		c.width = width
		c.height = height
		c.style.width = width
		c.style.height = height
		c.src = url
	}

	useEffect(
		(_) => {
			let t
			const frame = async (_) => {
				console.log(doDraw)
				if (!doDraw) {
					// console.log('no draw')
					return (t = setTimeout(frame, 200))
				}
				console.log('drw')
				await draw()
				return (t = setTimeout(frame, 200))
			}
			t = frame()
			return (_) => {
				clearInterval(draw)
			}
		},
		[doDraw]
	)

	return (
		<div>
			<Test />
			<canvas ref={canvasRef} style={{ position: 'absolute', right: '99999px' }}></canvas>
			<img ref={canvasRef2}></img>
			<input type="text" ref={inputRef}></input>

			<div>Seed: 1</div>
			{fetchImage?.current && <button onClick={draw}>UPDATE</button>}
			<button onClick={(_) => setDoDraw(!doDraw)}>{doDraw ? 'pause' : 'start'}</button>
		</div>
	)
}
