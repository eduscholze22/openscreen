import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import styles from "./RegionSelector.module.css";

const MIN_REGION_SIZE = 0.02;

type DragPoint = {
	x: number;
	y: number;
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function normalizePoint(clientX: number, clientY: number, rect: DOMRect): DragPoint {
	return {
		x: clamp((clientX - rect.left) / rect.width, 0, 1),
		y: clamp((clientY - rect.top) / rect.height, 0, 1),
	};
}

function toRegion(start: DragPoint, end: DragPoint): CaptureRegion {
	const x = Math.min(start.x, end.x);
	const y = Math.min(start.y, end.y);
	const width = Math.abs(end.x - start.x);
	const height = Math.abs(end.y - start.y);

	return { x, y, width, height };
}

function hasValidRegion(region: CaptureRegion | null): region is CaptureRegion {
	return !!region && region.width >= MIN_REGION_SIZE && region.height >= MIN_REGION_SIZE;
}

export function RegionSelector() {
	const t = useScopedT("launch");
	const tc = useScopedT("common");
	const imageRef = useRef<HTMLImageElement | null>(null);
	const [selectedSource, setSelectedSource] = useState<ProcessedDesktopSource | null>(null);
	const [previewSrc, setPreviewSrc] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [dragStart, setDragStart] = useState<DragPoint | null>(null);
	const [draftRegion, setDraftRegion] = useState<CaptureRegion | null>(null);
	const [selection, setSelection] = useState<CaptureRegion | null>(null);

	useEffect(() => {
		async function loadPreview() {
			setLoading(true);
			try {
				const source = await window.electronAPI.getSelectedSource();
				if (!source || !source.id.startsWith("screen:")) {
					window.close();
					return;
				}

				setSelectedSource(source);
				setSelection(source.captureRegion ?? null);

				const sources = await window.electronAPI.getSources({
					types: ["screen"],
					thumbnailSize: {
						width: Math.max(1, Math.ceil(window.innerWidth * window.devicePixelRatio)),
						height: Math.max(1, Math.ceil(window.innerHeight * window.devicePixelRatio)),
					},
					fetchWindowIcons: false,
				});

				const matchingSource = sources.find((candidate) => candidate.id === source.id) ?? source;
				setPreviewSrc(matchingSource.thumbnail ?? source.thumbnail);
			} catch (error) {
				console.error("Failed to load region selector preview:", error);
			} finally {
				setLoading(false);
			}
		}

		void loadPreview();
	}, []);

	const activeRegion = draftRegion ?? selection;

	const selectionStyle = useMemo(() => {
		if (!activeRegion) return null;
		return {
			left: `${activeRegion.x * 100}%`,
			top: `${activeRegion.y * 100}%`,
			width: `${activeRegion.width * 100}%`,
			height: `${activeRegion.height * 100}%`,
		};
	}, [activeRegion]);

	const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0 || !imageRef.current) return;

		const rect = imageRef.current.getBoundingClientRect();
		const insideImage =
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= rect.top &&
			event.clientY <= rect.bottom;
		if (!insideImage) return;

		const start = normalizePoint(event.clientX, event.clientY, rect);
		setDragStart(start);
		setDraftRegion({ x: start.x, y: start.y, width: 0, height: 0 });
		event.currentTarget.setPointerCapture(event.pointerId);
	};

	const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!dragStart || !imageRef.current) return;

		const rect = imageRef.current.getBoundingClientRect();
		const end = normalizePoint(event.clientX, event.clientY, rect);
		setDraftRegion(toRegion(dragStart, end));
	};

	const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
		if (!dragStart || !imageRef.current) return;

		const rect = imageRef.current.getBoundingClientRect();
		const end = normalizePoint(event.clientX, event.clientY, rect);
		const region = toRegion(dragStart, end);

		setDragStart(null);
		setDraftRegion(null);
		setSelection(hasValidRegion(region) ? region : null);
		event.currentTarget.releasePointerCapture(event.pointerId);
	};

	const handleConfirm = async () => {
		if (!selectedSource || !hasValidRegion(selection)) return;
		const region = selection;

		await window.electronAPI.selectSource({
			...selectedSource,
			captureRegion: region,
		});
	};

	const regionLabel = useMemo(() => {
		if (!hasValidRegion(activeRegion) || !imageRef.current) return null;
		const region = activeRegion;
		const width = Math.round(imageRef.current.clientWidth * region.width);
		const height = Math.round(imageRef.current.clientHeight * region.height);
		return `${width} × ${height}`;
	}, [activeRegion]);

	return (
		<div className={styles.overlay}>
			<div className={styles.hud}>
				<p className="text-white text-sm font-medium">{t("sourceSelector.selectRegion")}</p>
				<p className="text-white/60 text-xs mt-1">{t("sourceSelector.regionHint")}</p>
			</div>

			<div
				className={styles.previewViewport}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
			>
				{previewSrc ? (
					<img ref={imageRef} src={previewSrc} alt="" className={styles.previewImage} />
				) : (
					<div className="w-full h-full flex items-center justify-center text-white/70 text-sm">
						{loading ? t("sourceSelector.loadingPreview") : t("sourceSelector.loading")}
					</div>
				)}

				{selectionStyle && (
					<div className={styles.selection} style={selectionStyle}>
						{regionLabel ? <div className={styles.dimensionLabel}>{regionLabel}</div> : null}
					</div>
				)}
			</div>

			<div className={styles.footer}>
				<Button
					variant="ghost"
					onClick={() => window.close()}
					className="rounded-full text-zinc-300"
				>
					{tc("actions.cancel")}
				</Button>
				<Button
					onClick={handleConfirm}
					disabled={!hasValidRegion(selection)}
					className="rounded-full bg-[#34B27B] text-white hover:bg-[#34B27B]/80 disabled:bg-zinc-700"
				>
					{tc("actions.done")}
				</Button>
			</div>
		</div>
	);
}
