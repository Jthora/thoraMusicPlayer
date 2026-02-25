jest.mock('react-native-mmkv', () => {
  const memory = new Map();

  return {
    createMMKV: () => ({
      getString: key => (memory.has(key) ? memory.get(key) : undefined),
      set: (key, value) => {
        memory.set(key, value);
      },
      remove: key => {
        memory.delete(key);
      },
    }),
  };
});
