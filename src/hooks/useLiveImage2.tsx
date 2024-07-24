import { LiveImageShape } from '@/components/LiveImageShapeUtil'
import { useWebcam } from '@/components/webcam'
import { blobToDataUri } from '@/utils/blob'
import * as fal from '@fal-ai/serverless-client'
import {
	AssetRecordType,
	Editor,
	TLShape,
	TLShapeId,
	getHashForObject,
	getSvgAsImage,
	rng,
	useEditor,
} from '@tldraw/tldraw'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
type LiveImageResult = { url: string }
type LiveImageRequest = {
	prompt: string
	image_url: string
	sync_mode: boolean
	strength: number
	seed: number
	enable_safety_checks: boolean
}
type LiveImageContextType = null | ((req: LiveImageRequest) => Promise<LiveImageResult>)
export const LiveImageContext = createContext<LiveImageContextType>(null)
export const TestCtx = createContext(1)
export function LiveImageProvider({
	children,
	appId,
	throttleTime = 0,
	timeoutTime = 5000,
}: {
	children: React.ReactNode
	appId: string
	throttleTime?: number
	timeoutTime?: number
}) {
	const [count, setCount] = useState(0)
	const [fetchImage, setFetchImage] = useState<{ current: LiveImageContextType }>({ current: null })

	const { stream, videoRef } = useWebcam()
	const [dataUrl, setDataUrl] = useState(null)
	const canvasRef = useRef()

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
		const requestsById = new Map<
			string,
			{
				resolve: (result: LiveImageResult) => void
				reject: (err: unknown) => void
				timer: ReturnType<typeof setTimeout>
			}
		>()

		const { send, close } = fal.realtime.connect(appId, {
			connectionKey: 'fal-realtime-example',
			clientOnly: false,
			throttleInterval: throttleTime,
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
	}, [appId, count, throttleTime, timeoutTime])

	console.log('CURRENT FETCH IMG', fetchImage.current)

	return (
		<LiveImageContext.Provider value={fetchImage.current}>
			<canvas ref={canvasRef}></canvas>
			<>{children}</>
		</LiveImageContext.Provider>
	)
}
export function Test() {
	// const fetchImage = useContext(LiveImageContext)
	// if (!fetchImage) throw new Error('Missing LiveImageProvider')
	// console.log('TEST PSSED', fetchImage)
	return <div></div>
}
export function useLiveImage(
	shapeId: TLShapeId,
	{ throttleTime = 64 }: { throttleTime?: number } = {}
) {
	const editor = useEditor()
	const fetchImage = useContext(LiveImageContext)
	if (!fetchImage) throw new Error('Missing LiveImageProvider')

	useEffect(() => {
		let prevHash = ''
		let prevPrompt = ''

		let startedIteration = 0
		let finishedIteration = 0

		async function updateDrawing() {
			const shapes = getShapesTouching(shapeId, editor)
			const frame = editor.getShape<LiveImageShape>(shapeId)!

			const hash = getHashForObject([...shapes])
			const frameName = frame.props.name
			// HERE
			//	if (hash === prevHash && frameName === prevPrompt) return

			startedIteration += 1
			const iteration = startedIteration

			prevHash = hash
			prevPrompt = frame.props.name

			try {
				const svg = await editor.getSvg([...shapes], {
					background: true,
					padding: 0,
					darkMode: editor.user.getIsDarkMode(),
					bounds: editor.getShapePageBounds(shapeId)!,
				})
				// cancel if stale:
				if (iteration <= finishedIteration) return

				if (!svg) {
					console.error('No SVG')
					updateImage(editor, frame.id, '')
					return
				}

				const image = await getSvgAsImage(svg, editor.environment.isSafari, {
					type: 'png',
					quality: 1,
					scale: 512 / frame.props.w,
				})
				// cancel if stale:
				if (iteration <= finishedIteration) return

				if (!image) {
					console.error('No image')
					updateImage(editor, frame.id, '')
					return
				}

				const prompt = frameName
					? frameName + ' hd award-winning impressive'
					: 'A robot with long hair inside a room sitting at his desk in a gaming chair'

				const imageDataUri = await blobToDataUri(image)

				// cancel if stale:
				if (iteration <= finishedIteration) return

				// downloadDataURLAsFile(imageDataUri, 'image.png')

				const random = rng(shapeId)

				const result = await fetchImage!({
					prompt,
					image_url: imageDataUri,
					sync_mode: true,
					strength: 0.65,
					seed: 1, // Math.abs(random() * 10000), // TODO make this configurable in the UI
					enable_safety_checks: false,
				})
				// cancel if stale:
				if (iteration <= finishedIteration) return

				finishedIteration = iteration
				updateImage(editor, frame.id, result.url)
			} catch (e) {
				const isTimeout = e instanceof Error && e.message === 'Timeout'
				if (!isTimeout) {
					console.error(e)
				}

				// retry if this was the most recent request:
				if (iteration === startedIteration) {
					requestUpdate()
				}
			}
		}

		let timer: ReturnType<typeof setTimeout> | null = null
		function requestUpdate() {
			if (timer !== null) return
			timer = setTimeout(() => {
				timer = null
				updateDrawing()
			}, throttleTime)
		}

		const i = setInterval((_) => {
			// requestUpdate()
			// updateDrawing()
		}, 300)

		editor.on('update-drawings' as any, requestUpdate)
		return () => {
			editor.off('update-drawings' as any, requestUpdate)
			clearInterval(i)
		}
	}, [editor, fetchImage, shapeId, throttleTime])
}
// export function useLiveImage2(

// ) {

// 	const fetchImage = useContext(LiveImageContext)
// 	if (!fetchImage) throw new Error('Missing LiveImageProvider')

// 	useEffect(() => {
// 		let prevHash = ''
// 		let prevPrompt = ''

// 		let startedIteration = 0
// 		let finishedIteration = 0

// 		async function updateDrawing() {
// 			const shapes = getShapesTouching(shapeId, editor)
// 			const frame = editor.getShape<LiveImageShape>(shapeId)!

// 			const hash = getHashForObject([...shapes])
// 			const frameName = frame.props.name
// 			// HERE
// 			//	if (hash === prevHash && frameName === prevPrompt) return

// 			startedIteration += 1
// 			const iteration = startedIteration

// 			prevHash = hash
// 			prevPrompt = frame.props.name

// 			try {

// 				const prompt = frameName
// 					? frameName + ' hd award-winning impressive'
// 					: 'A robot with long hair inside a room sitting at his desk in a gaming chair'

// 				const result = await fetchImage!({
// 					prompt,
// 					image_url: imageDataUri,
// 					sync_mode: true,
// 					strength: 0.65,
// 					seed: 1, // Math.abs(random() * 10000), // TODO make this configurable in the UI
// 					enable_safety_checks: false,
// 				})

// 				updateImage(editor, frame.id, result.url)
// 			} catch (e) {
// 				const isTimeout = e instanceof Error && e.message === 'Timeout'
// 				if (!isTimeout) {
// 					console.error(e)
// 				}

// 				// retry if this was the most recent request:
// 				if (iteration === startedIteration) {
// 					requestUpdate()
// 				}
// 			}
// 		}

// 		let timer: ReturnType<typeof setTimeout> | null = null
// 		function requestUpdate() {
// 			if (timer !== null) return
// 			timer = setTimeout(() => {
// 				timer = null
// 				updateDrawing()
// 			}, throttleTime)
// 		}

// 		const i = setInterval((_) => {
// 			// requestUpdate()
// 			// updateDrawing()
// 		}, 300)

// 		return () => {

// 			clearInterval(i)
// 		}
// 	}, [ fetchImage])
// }

function updateImage(editor: Editor, shapeId: TLShapeId, url: string | null) {
	const shape = editor.getShape<LiveImageShape>(shapeId)!
	const id = AssetRecordType.createId(shape.id.split(':')[1])

	const asset = editor.getAsset(id)

	if (!asset) {
		editor.createAssets([
			AssetRecordType.create({
				id,
				type: 'image',
				props: {
					name: shape.props.name,
					w: shape.props.w,
					h: shape.props.h,
					src: url,
					isAnimated: false,
					mimeType: 'image/jpeg',
				},
			}),
		])
	} else {
		editor.updateAssets([
			{
				...asset,
				type: 'image',
				props: {
					...asset.props,
					w: shape.props.w,
					h: shape.props.h,
					src: url,
				},
			},
		])
	}
}

function getShapesTouching(shapeId: TLShapeId, editor: Editor) {
	const shapeIdsOnPage = editor.getCurrentPageShapeIds()
	const shapesTouching: TLShape[] = []
	const targetBounds = editor.getShapePageBounds(shapeId)
	if (!targetBounds) return shapesTouching
	for (const id of [...shapeIdsOnPage]) {
		if (id === shapeId) continue
		const bounds = editor.getShapePageBounds(id)!
		if (bounds.collides(targetBounds)) {
			shapesTouching.push(editor.getShape(id)!)
		}
	}
	return shapesTouching
}

function downloadDataURLAsFile(dataUrl: string, filename: string) {
	const link = document.createElement('a')
	link.href = dataUrl
	link.download = filename
	link.click()
}
