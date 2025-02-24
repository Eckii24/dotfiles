# Coding conventions

## Writing code
- Consider basic principles of
  - DRY (Don't Repeat Yourself)
  - SOLID (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion)
  - YAGNI (You Aren't Gonna Need It)
- Use meaning names for variables, methods, classes, etc.
- Avoid boolean parameters in methods, use a method overload instead
- Use braces for all control structures, even for single lines
- Use new lines to separate logical blocks of code
- Always add a new line before return statements
- Add doc strings to all public methods, properties, classes, etc.
- Only comments inline, if the information is not obvious from the code
- Use constants for magic numbers and strings

### Dotnet and C# related
- Use dotnet and c# best pracices whenever possible
- Declare variables with `var` in c# if possible/allowed
- Use records for value objects when possible

## Writing tests
- Use `mstest` when testing c# code
- Use the following libraries for testing c# code
  - `Moq` for mocking
  - `FluentAssertions` for assertions
  - `AutoFixture` for creating test data
- Use the `arrange/act/assert` pattern when writing tests
