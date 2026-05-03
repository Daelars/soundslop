import { NextRequest, NextResponse } from 'next/server';

import { getLibraryRoot, getLibraryStats } from '@/lib/db';
import { saveLibraryRoot, validateLibraryRoot } from '@/lib/scanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    libraryRoot: getLibraryRoot(),
    stats: getLibraryStats(),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body?.action;

    if (action === 'validate') {
      const pathValue = String(body?.path ?? '');
      const result = await validateLibraryRoot(pathValue);
      return NextResponse.json(result, { status: result.valid ? 200 : 400 });
    }

    if (action === 'save') {
      const pathValue = String(body?.path ?? '');
      const validation = await validateLibraryRoot(pathValue);

      if (!validation.valid || validation.normalizedPath === null) {
        return NextResponse.json(validation, { status: 400 });
      }

      saveLibraryRoot(validation.normalizedPath);

      return NextResponse.json({
        success: true,
        libraryRoot: validation.normalizedPath,
        stats: getLibraryStats(),
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Settings request failed' },
      { status: 500 },
    );
  }
}
