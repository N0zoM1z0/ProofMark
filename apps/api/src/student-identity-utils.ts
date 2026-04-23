import { sha256Hex } from './submission-utils.js';

export function canonicalStudentHash(studentId: string) {
  return sha256Hex(studentId.trim());
}

export function canonicalOperatorHash(operatorId: string) {
  return sha256Hex(operatorId.trim());
}
