import * as fal from '@fal-ai/serverless-client'
import { useEffect, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import './style.css'
import { useWebcam } from './webcam'
async function updateDrawing({ fetchImage, imageUrl, prompt, seed, strength }) {
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
			strength,
			seed, // Math.abs(random() * 10000), // TODO make this configurable in the UI
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

	const [src, setSrc] = useState('cam')

	const { stream, videoRef, dim } = useWebcam()
	const [dataUrl, setDataUrl] = useState(null)
	const canvasRef = useRef()
	const canvasRef2 = useRef()
	const canvasRef3 = useRef()
	const seedRef = useRef()
	const strengthRef = useRef()
	const inputRef = useRef()
	const iframeRef = useRef()
	const imgRef = useRef()

	const captureFrame = () => {
		const canvas = canvasRef.current
		console.log('Capture frane')
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
					//
					if (typeof req.image_url !== 'string') {
						const url = captureFrame()
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

	const draw = async (imageUrl) => {
		if (!fetchImage.current) return
		console.log('DRAW', !!imageUrl)
		const d = await updateDrawing({
			fetchImage: fetchImage.current,
			imageUrl: imageUrl || captureFrame(),
			prompt: inputRef.current.value,
			seed: seedRef.current.value,
			strength: strengthRef.current.value / 100,
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
	// useEffect(() => {
	// 	console.log('DIM', dim)
	// 	if (videoRef.current) {
	// 		for (let key of ['width', 'height']) {
	// 			const c = canvasRef2.current
	// 			c[key] = dim[key]
	// 			c.style[key] = dim[key] + 'px'
	// 		}
	// 	}
	// }, [videoRef, dim])

	const doDrawRef = useRef(doDraw)
	const waitingForIframe = useRef(false)

	useEffect(() => {
		doDrawRef.current = doDraw
	}, [doDraw])
	useEffect(
		(_) => {
			let t
			const frame = async (_) => {
				const doDraw = doDrawRef.current

				if (!doDraw) {
					// console.log('no draw')
					return (t = setTimeout(frame, 200))
				}

				if (src === 'cam') {
					await draw()
				} else if (!waitingForIframe.current) {
					iframeRef.current.contentWindow.postMessage({ type: 'screenshot' }, '*')
					waitingForIframe.current = true
				}
				//
				return (t = setTimeout(frame, 200))
			}
			t = frame()
			return (_) => {
				clearInterval(draw)
			}
		},
		[doDraw]
	)

	useEffect(() => {
		function renderImage(canvas, blob) {
			const ctx = canvas.getContext('2d')
			const img = new Image()
			img.onload = (event) => {
				URL.revokeObjectURL(event.target.src) // 👈 This is important. If you are not using the blob, you should release it if you don't want to reuse it. It's good for memory.
				ctx.drawImage(event.target, 0, 0)
				const url = canvas.toDataURL()
				// imgRef.current.src = url
				waitingForIframe.current = false
				draw(url)
			}
			img.src = URL.createObjectURL(blob)
		}
		const onWindowMessage = (e) => {
			if (e.data && e.data.type === 'screenshot') {
				// alert('YEA')
				const blob = e.data.data
				renderImage(canvasRef3.current, blob)
			}
		}
		window.addEventListener('message', onWindowMessage)
		return (_) => {
			window.removeEventListener('message', onWindowMessage)
		}
	})
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const assetId = params.get('assetId')
		if (assetId) iframeRef.current.src = 'https://webremixer.com/view/?assetId=' + assetId
	})

	return (
		<>
			<div className="UI" style={{ maxHeight: '100vh', overflow: 'auto' }}>
				<canvas ref={canvasRef} style={{ position: 'absolute', right: '99999px' }}></canvas>
				<div style={{ display: 'flex', width: 'fit-content' }}>
					<iframe
						src="https://webremixer.com/view/?assetId=667450ed31837dfe64e6899d"
						ref={iframeRef}
						width={'512px'}
						height={'512px'}
					></iframe>
					<canvas
						ref={canvasRef3}
						width={'512px'}
						height={'512px'}
						style={{ width: '512px', height: '512px' }}
					></canvas>
					<img ref={imgRef}></img>
				</div>

				<img ref={canvasRef2} style={{ position: 'absolute', top: '512px' }}></img>
			</div>
			<div className="Controls">
				<textarea
					type="text"
					ref={inputRef}
					defaultValue={'A robot sitting at a desk'}
					rows={4}
					cols={50}
				></textarea>
				<label>
					Seed
					<input type="range" ref={seedRef} min={0} max={1000} defaultValue={1}></input>
				</label>
				<label>
					Strength
					<input type="range" ref={strengthRef} min={10} max={100} defaultValue={60}></input>
				</label>

				<div style={{ display: 'flex' }}>
					{fetchImage?.current && (
						<button
							onClick={(_) => {
								if (src === 'cam') draw()
								else iframeRef.current.contentWindow.postMessage({ type: 'screenshot' }, '*')
							}}
						>
							TAKE SINGLE
						</button>
					)}
					{fetchImage?.current && (
						<button onClick={(_) => setDoDraw(!doDraw)}>{doDraw ? 'pause' : 'start'}</button>
					)}
					{/* <button onClick={(_) => {}}>COMP</button> */}
					<div>
						<label onClick={(_) => setSrc('cam')}>
							{' '}
							Webcam
							<input type="radio" name="type" value="cam" checked={src === 'cam'}></input>
						</label>
						<label onClick={(_) => setSrc('comp')}>
							{' '}
							Comp
							<input type="radio" name="type" value="comp" checked={src === 'comp'}></input>
						</label>
					</div>
				</div>
			</div>
		</>
	)
}
