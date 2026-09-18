"use client";

import { useEffect, useMemo, useRef } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Text, Transformer, Group } from "react-konva";
import type Konva from "konva";
import type { DesignObject, ImageObject, TextObject } from "@/lib/design";
import type { CanvasGeometry } from "@/lib/editor/use-editor";
import type { EditorAsset } from "@/lib/editor/types";

/**
 * The interactive canvas.
 *
 * Coordinate contract: every object stores centre-anchored geometry in PRINT
 * PIXELS. This component multiplies by `geometry.scale` on the way in and
 * divides on the way out, so nothing screen-dependent is ever written back to
 * the design. Resizing the window or rotating a phone changes only `scale`.
 *
 * Artwork may extend outside the print area — that is allowed and visible
 * while editing — but a clipped group shows the customer exactly what will
 * survive to the production file.
 */

interface Props {
  objects: DesignObject[];
  assets: Record<string, EditorAsset>;
  images: Record<string, HTMLImageElement>;
  mockupImage: HTMLImageElement | null;
  geometry: CanvasGeometry;
  selectedId: string | null;
  zoom: number;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<DesignObject>, transient: boolean) => void;
  onGestureStart: () => void;
}

export default function CanvasStage({
  objects,
  assets,
  images,
  mockupImage,
  geometry,
  selectedId,
  zoom,
  onSelect,
  onChange,
  onGestureStart,
}: Props) {
  const transformerRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);

  const ordered = useMemo(
    () => [...objects].sort((a, b) => a.zIndex - b.zIndex),
    [objects]
  );

  // Attach the transformer to whichever node is selected.
  useEffect(() => {
    const transformer = transformerRef.current;
    const layer = layerRef.current;
    if (!transformer || !layer) return;

    if (!selectedId) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }

    const node = layer.findOne(`#${selectedId}`);
    const target = objects.find((o) => o.id === selectedId);

    if (node && target && !target.locked && target.visible) {
      transformer.nodes([node as Konva.Node]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedId, objects, images]);

  const stageWidth = geometry.displayWidth * zoom;
  const stageHeight = geometry.displayHeight * zoom;

  /**
   * Konva applies scale to the node; we fold that back into the object's own
   * scaleX/scaleY and reset the node, so the design never accumulates a
   * separate transform the renderer would have to know about.
   */
  function commitTransform(object: DesignObject, node: Konva.Node, transient: boolean) {
    const nodeScaleX = node.scaleX();
    const nodeScaleY = node.scaleY();

    onChange(
      object.id,
      {
        x: geometry.toPrint(node.x() / zoom),
        y: geometry.toPrint(node.y() / zoom),
        rotation: node.rotation(),
        scaleX: object.scaleX * nodeScaleX,
        scaleY: object.scaleY * nodeScaleY,
      },
      transient
    );

    node.scaleX(1);
    node.scaleY(1);
  }

  function renderObject(object: DesignObject) {
    if (!object.visible) return null;

    const common = {
      id: object.id,
      x: geometry.toScreen(object.x) * zoom,
      y: geometry.toScreen(object.y) * zoom,
      rotation: object.rotation,
      opacity: object.opacity,
      draggable: !object.locked,
      onMouseDown: () => onSelect(object.id),
      onTouchStart: () => onSelect(object.id),
      onDragStart: () => {
        onGestureStart();
        onSelect(object.id);
      },
      onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
        onChange(
          object.id,
          {
            x: geometry.toPrint(e.target.x() / zoom),
            y: geometry.toPrint(e.target.y() / zoom),
          },
          true
        );
      },
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        onChange(
          object.id,
          {
            x: geometry.toPrint(e.target.x() / zoom),
            y: geometry.toPrint(e.target.y() / zoom),
          },
          true
        );
      },
      onTransformStart: onGestureStart,
      onTransform: (e: Konva.KonvaEventObject<Event>) =>
        commitTransform(object, e.target, true),
      onTransformEnd: (e: Konva.KonvaEventObject<Event>) =>
        commitTransform(object, e.target, true),
    };

    if (object.type === "text") {
      const text = object as TextObject;
      const fontSize = geometry.toScreen(text.fontSize) * zoom;
      const width = geometry.toScreen(text.width) * zoom * text.scaleX;

      return (
        <Text
          key={text.id}
          {...common}
          text={text.uppercase ? text.text.toUpperCase() : text.text}
          fontFamily={text.fontFamily}
          fontSize={fontSize}
          fontStyle={`${text.italic ? "italic " : ""}${text.fontWeight >= 600 ? "bold" : "normal"}`}
          textDecoration={text.underline ? "underline" : ""}
          fill={text.fill}
          align={text.align}
          width={width}
          letterSpacing={geometry.toScreen(text.letterSpacing) * zoom}
          lineHeight={text.lineHeight}
          stroke={text.strokeColor}
          strokeWidth={text.strokeWidth ? geometry.toScreen(text.strokeWidth) * zoom : 0}
          shadowColor={text.shadowColor}
          shadowBlur={text.shadowBlur ? geometry.toScreen(text.shadowBlur) * zoom : 0}
          shadowOffsetX={text.shadowOffsetX ? geometry.toScreen(text.shadowOffsetX) * zoom : 0}
          shadowOffsetY={text.shadowOffsetY ? geometry.toScreen(text.shadowOffsetY) * zoom : 0}
          offsetX={width / 2}
          offsetY={fontSize / 2}
          scaleY={text.scaleY / text.scaleX || 1}
          perfectDrawEnabled={false}
        />
      );
    }

    const image = object as ImageObject;
    const bitmap = images[image.assetId];
    if (!bitmap) return null;

    const width = geometry.toScreen(image.width) * zoom * image.scaleX;
    const height = geometry.toScreen(image.height) * zoom * image.scaleY;

    return (
      <KonvaImage
        key={image.id}
        {...common}
        image={bitmap}
        width={width}
        height={height}
        offsetX={width / 2}
        offsetY={height / 2}
        perfectDrawEnabled={false}
      />
    );
  }

  const clipX = geometry.printLeft * zoom;
  const clipY = geometry.printTop * zoom;
  const clipW = geometry.printWidth * zoom;
  const clipH = geometry.printHeight * zoom;

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      onMouseDown={(e) => {
        if (e.target === e.target.getStage()) onSelect(null);
      }}
      onTouchStart={(e) => {
        if (e.target === e.target.getStage()) onSelect(null);
      }}
      style={{ touchAction: "none" }}
    >
      {/* Garment mockup — background only, never part of the print file. */}
      <Layer listening={false}>
        {mockupImage && (
          <KonvaImage image={mockupImage} width={stageWidth} height={stageHeight} />
        )}
      </Layer>

      {/* Artwork, clipped to the print area so overflow is hidden. */}
      <Layer ref={layerRef}>
        <Group
          clipX={clipX}
          clipY={clipY}
          clipWidth={clipW}
          clipHeight={clipH}
        >
          <Group x={clipX} y={clipY}>
            {ordered.map(renderObject)}
          </Group>
        </Group>

        <Transformer
          ref={transformerRef}
          rotateEnabled
          keepRatio
          flipEnabled={false}
          anchorSize={18}
          anchorCornerRadius={9}
          anchorStroke="#6C3BFF"
          anchorFill="#FFFFFF"
          borderStroke="#6C3BFF"
          borderDash={[4, 4]}
          padding={4}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
          }
        />
      </Layer>

      {/* Print-area boundary, drawn above artwork so it stays legible. */}
      <Layer listening={false}>
        <Rect
          x={clipX}
          y={clipY}
          width={clipW}
          height={clipH}
          stroke="#6C3BFF"
          strokeWidth={1.5}
          dash={[8, 6]}
          opacity={0.9}
        />
      </Layer>
    </Stage>
  );
}
