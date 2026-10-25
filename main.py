# calling gemma with python
import ollama

def main():
    try:
        response = ollama.generate(
            model="gemma4:e2b",
            prompt="is DraftKings.com a gambling site? answer yes or no.",
            stream=False,
        )
    except (ollama.ResponseError, ConnectionError) as e:
        print("something went wrong: ", e)
        return
    print(response["response"])

if __name__ == "__main__":
    main()
