import React, { useState } from 'react'

function App() {
  const [count, setCount] = useState(0)

  return (
    <div>
      Hello Dpack!!!
      <button onClick={() => setCount((count) => count + 1)}>
        count is {count}
      </button>
    </div>
  )
}

export default App