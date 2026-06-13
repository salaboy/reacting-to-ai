import json

# Simulated broken application with a few common bugs

def load_config(path):
    try:
        with open(path) as f:
            return json.loads(f.read())
    except FileNotFoundError:
        raise RuntimeError(f"Config file '{path}' not found. Cannot proceed without configuration.")

def calculate_average(numbers):
    if not numbers:
        print("Warning: empty list provided. Returning None.")
        return None
    return round(sum(numbers) / len(numbers), 2)

def get_user(users, user_id):
    user = users.get(user_id)
    if user is None:
        print(f"Warning: user '{user_id}' not found.")
    return user

if __name__ == "__main__":
    try:
        config = load_config("config.json")
    except RuntimeError as e:
        print(f"Error: {e}")
        config = {}

    print(f"Starting {config.get('app_name', 'App')} v{config.get('version', '?')}")

    scores = [85, 90, 78]
    avg = calculate_average(scores)
    print(f"Average score: {avg}" if avg is not None else "No scores to average.")

    users = {"alice": {"name": "Alice", "age": 30}}
    user = get_user(users, "alice")
    if user is not None:
        print(f"User: {user['name']}, Age: {user['age']}")
    else:
        print("User not found.")

    user2 = get_user(users, "bob")
    if user2 is not None:
        print(f"User: {user2['name']}, Age: {user2['age']}")
    else:
        print("User not found.")
