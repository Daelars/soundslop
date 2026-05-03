import { NextRequest, NextResponse } from 'next/server';

import { getFileById } from '@/lib/db';
import { getR2Object, getR2ObjectHead } from '@/lib/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getContentType(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'mp3';
  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aiff: 'audio/aiff',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
  };

  return mimeTypes[ext] || 'audio/mpeg';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  let filePath: string | null = null;

  if (id) {
    const file = getFileById(id);
    if (file) filePath = file.path;
  }

  if (!filePath) {
    return NextResponse.json({ error: 'No file identified' }, { status: 400 });
  }

  try {
    const range = request.headers.get('range');
    const contentType = getContentType(filePath);

    if (range) {
      const object = await getR2Object(filePath, range);
      const body = object.Body;

      if (!body || typeof body.transformToWebStream !== 'function') {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
      }

      const headers = {
        'Content-Range': object.ContentRange ?? '',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(object.ContentLength ?? 0),
        'Content-Type': contentType,
      };

      return new NextResponse(body.transformToWebStream(), { headers, status: 206 });
    }

    const head = await getR2ObjectHead(filePath);
    const object = await getR2Object(filePath);
    const body = object.Body;

    if (!body || typeof body.transformToWebStream !== 'function') {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }

    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Length': String(head.ContentLength ?? object.ContentLength ?? 0),
      'Content-Type': contentType,
    };

    return new NextResponse(body.transformToWebStream(), { headers });
  } catch (err) {
    console.error("Audio stream error:", err);
    return NextResponse.json({ error: 'Failed to read file' }, { status: 500 });
  }
}
