import {
  createPublishedExam,
  getTestRuntimeConfig,
  waitForApiReady
} from './lib/test-helpers.js';

async function main() {
  await waitForApiReady();
  const exam = await createPublishedExam();

  console.log(
    JSON.stringify(
      {
        apiBaseUrl: getTestRuntimeConfig().apiBaseUrl,
        examId: exam.examId,
        nextSteps: [
          'The seeded exam is committed and currently in REGISTRATION.',
          'Open /student/register to create a local Semaphore wallet and register one commitment.',
          'After at least one commitment exists, promote the exam with the admin publish/open endpoints.',
          'Open /student/exam and submit one anonymous response.'
        ]
      },
      null,
      2
    )
  );
}

void main();
