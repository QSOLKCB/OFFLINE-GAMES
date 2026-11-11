#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Convert a triangulated Wavefront OBJ to a local JavaScript position asset. No dependencies."""
import argparse
import json
import math
from pathlib import Path


def convert(source):
    vertices, triangles = [], []
    for line_number, line in enumerate(source.splitlines(), 1):
        fields = line.split('#', 1)[0].split()
        if not fields:
            continue
        if fields[0] == 'v':
            if len(fields) != 4:
                raise ValueError(f'line {line_number}: vertices must have exactly x y z')
            vertex = [float(v) for v in fields[1:]]
            if not all(math.isfinite(v) and abs(v) <= 100000 for v in vertex):
                raise ValueError(f'line {line_number}: vertex is non-finite or out of bounds')
            vertices.append(vertex)
            if len(vertices) > 60000:
                raise ValueError('at most 60000 vertices')
        elif fields[0] == 'f':
            if len(fields) != 4:
                raise ValueError(f'line {line_number}: triangulate faces before export')
            face = []
            for field in fields[1:]:
                index = int(field.split('/')[0])
                if index == 0 or not -len(vertices) <= index <= len(vertices):
                    raise ValueError(f'line {line_number}: invalid vertex index')
                face.append(vertices[index - 1 if index > 0 else index])
            a, b, c = face
            u, v = [[p[i] - a[i] for i in range(3)] for p in [b, c]]
            cross = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]
            if math.hypot(*cross) < 1e-9:
                raise ValueError(f'line {line_number}: degenerate triangle')
            triangles.append(face)
            if len(triangles) > 20000:
                raise ValueError('at most 20000 triangles')
        # vt/vn/material/group declarations are intentionally omitted: flat colours/normals only.
    if not triangles:
        raise ValueError('no triangle faces')
    return triangles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    try:
        triangles = convert(args.input.read_text(encoding='utf-8'))
    except (ValueError, OSError) as error:
        parser.error(str(error))
    # Only write after complete validation. Asset licensing stays with the original creator.
    args.output.write_text('// Position-only mesh; add your asset licence attribution.\nexport const triangles = ' + json.dumps(triangles, separators=(',', ':'), allow_nan=False) + ';\n', encoding='utf-8')


if __name__ == '__main__':
    main()
