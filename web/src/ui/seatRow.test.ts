import { describe, expect, it } from 'vitest';
import type { Person } from '../api/http';
import { placeSeats, rowLength, standing, type Row } from './seatRow';

const person = (id: string): Person => ({ userId: id, name: id, role: 'member' });
const names = (row: Row) => row.map((seat) => seat && `${seat.person.userId}${seat.here ? '' : '?'}`);

describe('placeSeats', () => {
  it('seats people in the order they arrive', () => {
    expect(names(placeSeats([], [person('a'), person('b')]))).toEqual(['a', 'b']);
  });

  it('keeps everyone where they are when the member list reorders', () => {
    const row = placeSeats([], [person('a'), person('b'), person('c')]);
    expect(names(placeSeats(row, [person('c'), person('a'), person('b')]))).toEqual(['a', 'b', 'c']);
  });

  it('holds a seat for someone who stepped out, and gives it back', () => {
    const row = placeSeats([], [person('a'), person('b')]);
    const out = placeSeats(row, [person('a')]);
    expect(names(out)).toEqual(['a', 'b?']);
    expect(names(placeSeats(out, [person('b'), person('a')]))).toEqual(['a', 'b']);
  });

  it('seats a newcomer beside the empty seat, not in it, until the row is full', () => {
    const out = placeSeats(placeSeats([], [person('a'), person('b')]), [person('a')]);
    expect(names(placeSeats(out, [person('a'), person('c')]))).toEqual(['a', 'b?', 'c']);
  });

  it('gives away a held seat only when the row is full', () => {
    const row = placeSeats([], [person('a'), person('b')], 2);
    const out = placeSeats(row, [person('a')], 2);
    expect(names(placeSeats(out, [person('a'), person('c')], 2))).toEqual(['a', 'c']);
  });

  it('counts the people the row can’t hold', () => {
    const members = [person('a'), person('b'), person('c')];
    expect(standing(placeSeats([], members, 2), members)).toBe(1);
  });
});

describe('rowLength', () => {
  it('saves seats for a person alone', () => {
    expect(rowLength(placeSeats([], [person('a')]))).toBe(4);
  });

  it('always leaves one empty seat until the row is full', () => {
    const members = ['a', 'b', 'c', 'd', 'e'].map(person);
    expect(rowLength(placeSeats([], members))).toBe(6);
    expect(rowLength(placeSeats([], [...members, person('f'), person('g'), person('h')]))).toBe(8);
  });
});
