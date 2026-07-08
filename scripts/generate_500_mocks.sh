#!/bin/bash
mkdir -p test-vault/mock-files
for i in {1..500}; do
  echo "# Mock File $i" > test-vault/mock-files/mock-file-$i.md
done
echo "Generated 500 mock files in test-vault/mock-files/"
