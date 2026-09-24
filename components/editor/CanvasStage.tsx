"use client";

import React, { useEffect, useMemo, useRef } from "react";
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
 * Zoom behaviour: a single pivot Group (centred on the print area) scales
 * everything — shirt mockup, design objects, and the print-area border — so
 * zooming feels like a camera zoom rather than a content zoom.
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
  stageRef?: React.MutableRefObject<Konva.Stage | null>;
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Widest line of `text` in CSS px for the given canvas font string. */
function measureTextWidth(text: string, font: string, letterSpacing: number): number {
  if (typeof document === "undefined") return text.length * 10;
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 10;
  measureCtx.font = font;
  return Math.ceil(
    Math.max(
      ...text.split("\n").map(
        (line) => measureCtx!.measureText(line).width + letterSpacing * line.length
      )
    )
  );
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
  stageRef,
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
      // Text objects: allow only move + rotate, no resize handles.
      const isText = target.type === "text";
      transformer.enabledAnchors(isText ? [] : ["top-left", "top-right", "bottom-left", "bottom-right", "middle-left", "middle-right", "top-center", "bottom-center"]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [selectedId, objects, images]);

  const stageWidth = geometry.displayWidth;
  const stageHeight = geometry.displayHeight;

  // Print area rect in display coords (unscaled)
  const clipX = geometry.printLeft;
  const clipY = geometry.printTop;
  const clipW = geometry.printWidth;
  const clipH = geometry.printHeight;

  // Pivot: keep print-area centre pinned as zoom changes
  const printCx = clipX + clipW / 2;
  const printCy = clipY + clipH / 2;
  const pivotX = printCx * (1 - zoom);
  const pivotY = printCy * (1 - zoom);

  /**
   * Konva applies scale to the node; we fold that back into the object's own
   * scaleX/scaleY and reset the node, so the design never accumulates a
   * separate transform the renderer would have to know about.
   *
   * Object coords are in the parent group's LOCAL space (pre-zoom), so we
   * do NOT divide by zoom here — the group's scaleX handles that.
   */
  function commitTransform(object: DesignObject, node: Konva.Node, transient: boolean) {
    const nodeScaleX = node.scaleX();
    const nodeScaleY = node.scaleY();

    onChange(
      object.id,
      {
        x: geometry.toPrint(node.x() - geometry.printLeft),
        y: geometry.toPrint(node.y() - geometry.printTop),
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

    // Positions/sizes are in the pivot group's LOCAL space (no * zoom).
    const common = {
      id: object.id,
      // Object coords are in print-pixel space with origin at print-area top-left.
      // We add the print-area offset (printLeft/printTop) so the canvas origin
      // aligns with the print area, keeping hasOverflow and the dashed border
      // in the same coordinate frame as the rendered objects.
      x: geometry.printLeft + geometry.toScreen(object.x),
      y: geometry.printTop + geometry.toScreen(object.y),
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
            x: geometry.toPrint(e.target.x() - geometry.printLeft),
            y: geometry.toPrint(e.target.y() - geometry.printTop),
          },
          true
        );
      },
      onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
        onChange(
          object.id,
          {
            x: geometry.toPrint(e.target.x() - geometry.printLeft),
            y: geometry.toPrint(e.target.y() - geometry.printTop),
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
      const fontSize = geometry.toScreen(text.fontSize);
      const shown = text.uppercase ? text.text.toUpperCase() : text.text;
      // Size the box to the rendered text so there is no dead space around it.
      const width = Math.max(
        measureTextWidth(
          shown || " ",
          `${text.italic ? "italic " : ""}${text.fontWeight >= 600 ? "bold " : ""}${fontSize}px "${text.fontFamily}"`,
          geometry.toScreen(text.letterSpacing)
        ) * text.scaleX,
        4
      );

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
          letterSpacing={geometry.toScreen(text.letterSpacing)}
          lineHeight={text.lineHeight}
          wrap="none"
          stroke={text.strokeColor}
          strokeWidth={text.strokeWidth ? geometry.toScreen(text.strokeWidth) : 0}
          shadowColor={text.shadowColor}
          shadowBlur={text.shadowBlur ? geometry.toScreen(text.shadowBlur) : 0}
          shadowOffsetX={text.shadowOffsetX ? geometry.toScreen(text.shadowOffsetX) : 0}
          shadowOffsetY={text.shadowOffsetY ? geometry.toScreen(text.shadowOffsetY) : 0}
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

    const width = geometry.toScreen(image.width) * image.scaleX;
    const height = geometry.toScreen(image.height) * image.scaleY;

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

  return (
    <Stage
      ref={stageRef}
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
      {/* Background layer: shirt mockup + print-area border, all zoomed together. */}
      <Layer listening={false}>
        <Group x={pivotX} y={pivotY} scaleX={zoom} scaleY={zoom}>
          {mockupImage && (
            <KonvaImage image={mockupImage} width={stageWidth} height={stageHeight} />
          )}
          {/* Border stroke/dash compensated so visual thickness stays constant. */}
          <Rect
            name="print-area-border"
            x={clipX}
            y={clipY}
            width={clipW}
            height={clipH}
            stroke="#6C3BFF"
            strokeWidth={1.5 / zoom}
            dash={[8 / zoom, 6 / zoom]}
            opacity={0.9}
          />
        </Group>
      </Layer>

      {/* Artwork layer: objects clipped to the print area, same zoom pivot. */}
      <Layer ref={layerRef}>
        <Group x={pivotX} y={pivotY} scaleX={zoom} scaleY={zoom}>
          <Group
            clipX={clipX}
            clipY={clipY}
            clipWidth={clipW}
            clipHeight={clipH}
          >
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
          padding={2}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
          }
        />
      </Layer>
    </Stage>
  );
}
